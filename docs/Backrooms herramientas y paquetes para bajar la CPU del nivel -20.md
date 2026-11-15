# Backrooms: herramientas y paquetes para bajar la CPU del nivel -20

Nov 15, 2026 · @s7lver

## Top 5 por impacto/esfuerzo (nivel -20)

Lo más rentable es entender por qué cada dibujo cuesta 26 µs y recortar lo visible por habitaciones antes de añadir librerías; BatchedMesh llega después y exige subir three. Las versiones salen de fichas de npm, Socket, Snyk y depscope indexadas hasta nov 2026: desde aquí no pude consultar el registro de npm. Antes de adoptar algo, ejecuta `npm view <paquete> version time.modified peerDependencies license`.

1. **Averiguar de dónde salen las \~6 llamadas GL por dibujo (stats-gl + Spector.js + `renderer.info`): 2–4 h.** Con el estado cacheado, dibujos consecutivos con el mismo material y geometría deberían costar pocas llamadas GL; seis sugiere cambios de textura, uniformes o VAO en cada draw (hipótesis por confirmar). Abaratar eso baja los 26 µs de *todos* los dibujos, no solo de unos pocos. Con EffectComposer, `renderer.info` solo cuenta la última pasada salvo que desactives `autoReset` (ejemplo en la sección de código).
2. **Visibilidad por portales entre habitaciones, sin dependencias: 8–16 h.** Ya haces culling por distancia y habitación; recorrer el grafo de puertas desde la habitación del jugador y ocultar el resto elimina dibujos enteros en pasillos y suites con puertas cerradas. Es la palanca con más potencial; mídela contando dibujos antes y después.
3. **BatchedMesh para carteles, puertas y decoración con un material compartido (atlas o texture array): 12–30 h, exige subir three.** Convierte N dibujos en uno con multi-draw (`WEBGL_multi_draw`: Chrome 86+, Safari/iOS 15+; Firefox no). Con `sortObjects` y `perObjectFrustumCulled` activos (valores por defecto) mueve CPU de los dibujos al JS: desactívalos y culla por habitación. Conviene subir a r187, que corrige errores de ordenación y de rangos de dibujo.
4. **Canal de build con gltf-transform (`join`, `palette`, meshopt, KTX2): 6–12 h.** Fusiona mallas por material y reduce materiales en los GLB antes de que lleguen al cliente; meshopt es la compresión por defecto de la v4 y KTX2 ahorra VRAM en móviles (no CPU).
5. **Esqueletos solo para lo visible y cercano, sin dependencias: 4–8 h.** Cada SkinnedMesh cuesta CPU por el cálculo de huesos además del dibujo: actualiza mixer y skeleton solo en entidades de habitaciones visibles y baja la frecuencia con la distancia. Plan B si siguen siendo muchas: `@three.ez/instanced-mesh` (skinning, MIT).

No mejoran tu cuello de botella: WebGPURenderer (un informe de usuario con r183 midió ≈2× más CPU por dibujo) y cambiar de compositor de postprocesado (ayuda a la GPU, no a la CPU).

## Reducir dibujos y CPU en three.js

BatchedMesh existe en 0.160 (llegó en r159) pero sin las mejoras posteriores: opacidad por instancia en r183 y correcciones de ordenación y rangos en r187. Para decoración con un solo material compensa subir a r187; para el resto, el ahorro mayor es lógica propia (portales, esqueletos, atlas).

| Paquete | Para qué | Versión (fecha) | Licencia | Riesgo | ¿Encaja con three 0.160? |
| --- | --- | --- | --- | --- | --- |
| BatchedMesh (incluido en three) | N geometrías con 1 material en 1 dibujo (multi-draw) | r187 (inicios de nov 2026) | MIT | Medio | Existe desde r159, pero sin las correcciones de r183 y r187. Sin `WEBGL_multi_draw` (Firefox) hace un dibujo por instancia |
| [@three.ez/instanced-mesh](https://www.npmjs.com/package/@three.ez/instanced-mesh) | InstancedMesh con culling por instancia (BVH), LOD, uniforms por instancia y skinning | 0.3.13 (jsDelivr; release reciente según ecosyste.ms) | MIT | Medio: ≈8 400 descargas/mes, un mantenedor | Peer de three no verificado; pruébalo en 0.160 |
| [@three.ez/batched-mesh-extensions](https://www.npmjs.com/package/@three.ez/batched-mesh-extensions) | BVH, LOD y uniforms por instancia sobre BatchedMesh | 0.0.10 | MIT | Alto: versión 0.0.x, 358 descargas/semana; el LOD exige compartir el array de vértices | No verificado; asume que exige BatchedMesh reciente |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | Raycasts y consultas espaciales rápidas; `computeBatchedBoundsTree` para BatchedMesh | 0.9.15 (docs oficiales); fecha no verificada | MIT | Bajo | La 0.9.0 pide three con BatchedMesh (≥ r158); la 0.8.3 arregló BatchedMesh en r170: alinea ambas versiones |
| [three-pathfinding](https://github.com/donmccurdy/three-pathfinding/) | Navmesh y A\* | 1.3.0 (mayo 2024 según depscope) | MIT | Bajo, pero sin publicar en >18 meses (estable) | Sí; no lo recomiendo (ver sección «Lo que NO recomiendo») |
| [@guestgd/three-sbml](https://www.pkgstats.com/pkg:three-sbml-guestgd) | BatchedMesh con skinning y LOD | 0.0.3 | No verificada | Alto: experimental | Necesita BatchedMesh reciente (no verificado) |

Sin paquete que valga la pena, hazlo tú:

- **Portal/occlusion culling:** ninguna librería encaja con una rejilla de habitaciones; el ejemplo de la sección de código recorre las puertas visibles.
- **Atlas de texturas:** no encontré un generador mínimo y mantenido. Dos rutas: script de build propio con sharp, o `DataArrayTexture` (incluida en three) con un índice de textura por instancia, como sugiere el autor de InstancedMesh2 en el foro de three.
- **Skinned instancing / VAT:** no hay paquete estable. Hay ejemplos (por ejemplo [threejs-gpu-skinning](https://github.com/mbarbier/threejs-gpu-skinning)) y el skinning de InstancedMesh2. Con pocos personajes, es más barato actualizar solo los visibles.
- **LOD automático:** `three.ez` lo trae para instancias; el `LOD` de three no reduce dibujos, solo geometría.

## Texturas y carga

KTX2 y meshopt ahorran VRAM, descarga y tiempo de carga; no reducen dibujos. Lo que sí reduce dibujos es fusionar mallas y materiales en el build (`join`, `palette`), que gltf-transform ofrece como funciones.

| Paquete | Para qué | Versión (fecha) | Licencia | Riesgo | ¿Encaja con three 0.160? |
| --- | --- | --- | --- | --- | --- |
| [@gltf-transform/cli](https://www.npmjs.com/package/@gltf-transform/cli) | `optimize`, `join`, `palette`, `instance`, meshopt y KTX2 en el build ([comandos](https://gltf-transform.dev/cli)) | 4.5.0 (actualizada 1 sep 2026, Socket) | MIT | Bajo | Sí: los GLB se cargan con `MeshoptDecoder` y `KTX2Loader` de `three/addons` |
| KTX2Loader + transcodificador Basis (incluido en `three/addons`) | KTX2 a BC7 en escritorio y ASTC/ETC2 en móvil | Con three | MIT | Bajo | Sí. Sin ETC2, ASTC ni BC7 cae a RGBA32 sin comprimir |
| MeshoptDecoder (`three/addons`) | Decodifica geometría y animación comprimidas | Con three | MIT | Bajo | Sí |
| DRACOLoader (`three/addons`) | Geometría con Draco | Con three | Apache-2.0 | Medio: decodifica más lento que meshopt (de memoria, no medido) | Sí; gltf-transform v4 usa meshopt por defecto |

Notas de uso:

- `optimize --compress meshopt --texture-compress ktx2` hace todo en un paso, y el codificador KTX2 usa UASTC para normales/oclusión/metal-rugosidad y ETC1S para el resto. Según una guía de terceros, necesita KTX-Software ≥ 4.4 instalado en la máquina de build: verifícalo.
- Si un modelo ya está bien (pocos materiales), `--simplify false` evita que el optimizador reduzca triángulos.
- `ktx-parse` es dependencia interna del loader de three; no hace falta instalarla aparte.
- No encontré un generador de atlas mantenido que recomiende por encima de un script propio.

## Render moderno: WebGPU y postprocesado

No migres a WebGPURenderer por este problema: el manual de three dice que `onBeforeCompile`, `ShaderMaterial` y EffectComposer no funcionan con él, y un informe de usuario con r183 midió ≈2× más CPU por dibujo y un primer fotograma 5–10× más lento que con WebGLRenderer en escenas de muchas mallas. El propio manual describe WebGLRenderer como la opción recomendada para aplicaciones WebGL 2 puras, aunque sin funciones nuevas grandes.

| Opción | Para qué | Versión (fecha) | Licencia | Riesgo | ¿Encaja con three 0.160? |
| --- | --- | --- | --- | --- | --- |
| [WebGPURenderer](https://threejs.org/manual/pages/webgpurenderer) (`three/webgpu`) | Backend WebGPU con respaldo WebGL 2 | r187 | MIT | Alto | Exige subir y reescribir en TSL tu parche `onBeforeCompile`; EffectComposer pasa a `RenderPipeline` (renombrado en r183) |
| [postprocessing](https://www.npmjs.com/package/postprocessing) (pmndrs) | Fusiona efectos (bloom, grano, viñeta…) en un `EffectPass` | 6.39.x (publicada mar–abr 2026) | Zlib | Medio | Funciona con WebGLRenderer; peer de three no verificado. No mezcles su composer con el de three |
| EffectComposer (`three/addons/postprocessing`) | Tu pipeline actual: una pasada por efecto | Con three | MIT | Bajo | Sí |

**WebGPU en el navegador:** una guía de terceros lo da como estándar en los grandes navegadores desde ene 2026, con huecos en Firefox para Linux y iPhones antiguos; otra lo sitúa en ≈83 % de soporte global. Dos razones para esperar: el problema de coste por dibujo (issue #30560 de three, en curso según ese informe) y que `RenderBundle`/escenas estáticas estaban en desarrollo en las fuentes que vi (PR #28347, 2024), sin confirmar su estado actual.

**postprocessing vs EffectComposer:** `postprocessing` es más ligero en GPU porque fusiona efectos y evita lecturas y escrituras de pantalla completa; eso ayuda en gráficas integradas y móviles de gama media. En CPU gana poco (las pasadas son pocas). Haz esto después del trabajo de CPU: portar tu pasada VHS a un `Effect` propio es el coste principal, y exige `toneMapping = NoToneMapping` en el renderer y su propio `ToneMappingEffect` en lugar de `OutputPass`.

## Medición y diagnóstico

Empieza por Spector.js y el perfil de CPU de Chrome: son los que te dirán qué hace cada dibujo y qué función de three domina los 14–18 ms.

| Herramienta | Para qué | Versión (fecha) | Licencia | Riesgo | ¿Encaja con three 0.160? |
| --- | --- | --- | --- | --- | --- |
| [stats-gl](https://www.npmjs.com/package/stats-gl) | Paneles de FPS, CPU y GPU para WebGL y WebGPU | 4.2.3 (README en jsDelivr); fecha no verificada | MIT | Bajo | Sí. La GPU exige `EXT_disjoint_timer_query_webgl2`; en Safari hay que activar un flag |
| [Spector.js](https://github.com/BabylonJS/Spector.js) (`spectorjs`) | Captura un fotograma WebGL y muestra cada llamada GL | 0.9.x; versión y fecha no verificadas | MIT | Bajo (herramienta de desarrollo) | Sí, es independiente de three |
| `renderer.info` (incluido en three) | Dibujos, triángulos y memoria | Con three | MIT | Bajo | Sí. Con EffectComposer pon `renderer.info.autoReset = false` y llama a `reset()` una vez por fotograma |
| Chrome DevTools, pestaña Rendimiento | CPU por función (`renderBufferDirect`, `projectObject`, `updateMatrixWorld`) | Navegador | — | Bajo | Sí |
| r3f-perf | Panel para React Three Fiber | — | — | — | No aplica: exige R3F, y tu cliente usa three directo |

**Benchmarks en CI:** lo más estable es un presupuesto de dibujos por escena (`renderer.info.render.calls` en Chromium headless con Playwright) que falle el build al superarlo. El tiempo de CPU en CI solo sirve como comparación relativa entre commits, porque no reproduce tu GPU real.

**Frame pacing:** registra los fotogramas largos con `PerformanceObserver` y precompila shaders con `renderer.compileAsync(scene, camera)` al cambiar de nivel para evitar tirones de compilación. No hay paquete extra que valga la pena aquí.

## Build y bundle

El impacto sobre los fps es nulo; sirve para carga inicial y mantenimiento de shaders. Dos paquetes bastan.

| Paquete | Para qué | Versión (fecha) | Licencia | Riesgo | ¿Encaja con Vite 5 y three 0.160? |
| --- | --- | --- | --- | --- | --- |
| [vite-plugin-glsl](https://npmjs.com/package/vite-plugin-glsl) | Importa archivos `.glsl`/`.vert`/`.frag`, resuelve `#include` propios y puede minificar | 1.5.1 (ficha de Yarn); fecha no verificada | MIT | Bajo | Compatible con Vite 5 desde la 1.2.0 y con Vite 6 desde la 1.3.1. Ignora los `#include <chunk>` de three. Útil para sacar tu parche de iluminación horneada de las cadenas de texto |
| [rollup-plugin-visualizer](https://github.com/btd/rollup-plugin-visualizer) | Treemap del bundle para ver qué pesa | 6.0.x (changelog hasta 6.0.3; exige Node ≥ 20) | MIT (de memoria, no vista en las fuentes) | Bajo | Sí |

- **Code-splitting y precarga:** Vite ya lo trae. Separa `three`, `react` y cada nivel con `import()` dinámico y `build.rollupOptions.output.manualChunks`; Vite añade las etiquetas `modulepreload`.
- **Compresión gzip/brotli:** no verifiqué plugins; lo habitual es comprimir en el servidor o la CDN, y evita que el build se alargue.
- **Minificación de shaders:** el ahorro es pequeño frente a texturas y modelos; actívala solo si ya usas `vite-plugin-glsl`.

## Multijugador y servidor

Esto no toca tu cuello de botella (la CPU del cliente al enviar dibujos). Antes de cambiar nada, mide cuánto tarda el tick del servidor; si no pasa de unos pocos ms, lo más barato es mandar snapshots binarios cuantizados con socket.io, que ya admite binario.

| Paquete | Para qué | Versión (fecha) | Licencia | Riesgo | Nota |
| --- | --- | --- | --- | --- | --- |
| [msgpackr](https://www.npmjs.com/package/msgpackr) | Serializar snapshots en MessagePack; su README anuncia un 15–50 % más compacta (el extracto que vi no aclara frente a qué) | 2.0.4 (publicada 9 jun 2026) | MIT | Bajo | Funciona en navegador; trae una variante sin `eval` para CSP |
| [@geckos.io/snapshot-interpolation](https://www.npmjs.com/package/@geckos.io/snapshot-interpolation) | Buffer de interpolación de snapshots, con ayudas para predicción y reconciliación | 1.1.1 | BSD-3-Clause | Medio: ≈84 descargas/semana | Es una librería pequeña: puedes escribir tu propio buffer de interpolación en unas 60 líneas |
| [eiows](https://www.npmjs.com/package/eiows) | Sustituye a `ws` en engine.io (`wsEngine: eiows.Server`) | No verificada | No verificada | Medio | «Permite pero no garantiza» mejoras; solo Linux, FreeBSD y macOS; se compila con git |
| µWebSockets.js | Servidor HTTP/WebSocket nativo; socket.io lo admite con `io.attachApp(app)` desde la 4.4.0 | v20.x, se instala desde un tag de GitHub (los docs de socket.io usan v20.52.0) | No verificada (de memoria Apache-2.0) | Medio-alto | No está en el registro npm; su afirmación de «10× Socket.IO» viene de su propia documentación |
| [bitecs](https://github.com/NateTheGreatt/bitECS) | ECS con TypedArrays | 0.4.0 | MPL-2.0 (visto en la 0.3.x) | Alto | Ver «Lo que NO recomiendo» |

- **permessage-deflate:** en socket.io/engine.io viene desactivado por defecto (umbral de 1024 bytes cuando se activa). Con snapshots pequeños, comprimir cuesta más CPU que lo que ahorra.
- **Interpolación y predicción:** la simulación compartida en `shared` ya es la mitad del trabajo; falta un buffer de 100–150 ms de snapshots y reconciliar con el último ack del servidor.

## Física y colisiones

Mantén tus colisiones en rejilla: corren igual en cliente y servidor, no pesan nada y no tienes cuerpos dinámicos que justifiquen un motor. Ningún motor de física reduce dibujos.

| Paquete | Para qué | Versión (fecha) | Licencia | Riesgo | Nota |
| --- | --- | --- | --- | --- | --- |
| [@dimforge/rapier3d-compat](https://www.npmjs.com/package/@dimforge/rapier3d-compat) | Motor de física en WASM | 0.19.3 (depscope: actualizada nov 2025) | Apache-2.0 | Medio | ≈816 KB gzip con el WASM incrustado, mucho para «lo mínimo». Existe una variante determinista, `@dimforge/rapier3d-deterministic-compat`, útil si algún día simulas en cliente y servidor |
| [cannon-es](https://www.npmjs.com/package/cannon-es) | Motor de física en JS | 0.20.0 (hace ≈2 años) | MIT | Alto: sin publicar en más de 18 meses | Descártalo salvo que ya lo uses |
| [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | Raycasts rápidos contra mallas, no física | 0.9.15 | MIT | Bajo | Úsalo solo en el cliente (depende de three): disparos o interacciones contra mallas complejas |

Conviene que el servidor no importe three: si hay raycasts con autoridad en el servidor, hazlos contra tu rejilla o contra cajas simples en `shared`.

## Escritorio: Electron, Tauri y Steam

Para un juego WebGL, Electron te da un Chromium fijo y flags que controlas; Tauri usa el WebView del sistema, que en Windows es Chromium (WebView2) pero en macOS y Linux es WebKit, con otro comportamiento de WebGL. Ninguno arregla tu cuello de botella: la CPU por dibujo es del motor JS y de three, no del contenedor.

| Opción | Para qué | Versión (fecha) | Licencia | Riesgo | Nota |
| --- | --- | --- | --- | --- | --- |
| Electron | Chromium incluido, tú eliges la versión | No verificada | MIT (de memoria) | Bajo | Puedes usar flags de Chromium como `ignore-gpu-blocklist`, `disable-gpu-vsync` y `force-high-performance-gpu`, y la caché de shaders de disco; el switch `gpu-disk-cache-size-kb` existe, pero comprueba que afecte a escritorio |
| Tauri 2 | WebView del sistema, instalador pequeño | No verificada | MIT/Apache-2.0 (de memoria) | Medio | En Windows admite `additional_browser_args`, pero Microsoft desaconseja los flags de WebView2 en producción porque pueden cambiar o desaparecer. Un foro de Babylon.js reporta tirones en Tauri sobre WKWebView (macOS) que no aparecen en Safari |
| NW.js | Chromium incluido | No evaluada | — | — | No lo investigué |
| [steamworks.js](https://www.npmjs.com/package/steamworks.js) | Steamworks desde Node/Electron (logros, overlay) | No verificada | MIT (de memoria) | Medio | El README pide, para usarlo en el renderer, `contextIsolation: false` y `nodeIntegration: true`; mejor llámalo desde el proceso principal y expón solo lo necesario |

- **Si vas a Tauri:** en Rust, Steam se integra con `steamworks-rs`, que cita el proyecto Steam Achievement Notifier junto a steamworks.js.
- **Qué elegiría:** Electron si priorizas rendimiento predecible y Steam con steamworks.js; Tauri si priorizas tamaño y sobre todo apuntas a Windows, sin depender de flags.

## Audio y UX

Para un terror con sonido posicional, `PositionalAudio` de three (Web Audio, sin dependencias) cubre el audio espacial ligero; Howler solo aporta si necesitas sprites de audio o fallbacks.

| Paquete | Para qué | Versión (fecha) | Licencia | Riesgo | ¿Encaja con three 0.160? |
| --- | --- | --- | --- | --- | --- |
| PositionalAudio (incluido en three) | Audio 3D con el listener en la cámara | Con three | MIT | Bajo | Sí |
| [Howler.js](https://snyk.io/advisor/npm-package/howler) | Reproducción, sprites de audio y fallbacks | 2.2.4 (sep 2023) | MIT | Medio: más de 18 meses sin publicar, aunque estable y completo | Independiente de three |
| Tone.js | Síntesis y secuenciación | No investigada | — | — | No la recomiendo sin una necesidad concreta |

## Lo que NO recomiendo

- **Migrar a WebGPURenderer ahora.** Rompe `onBeforeCompile` y EffectComposer, y un informe con r183 midió ≈2× más CPU por dibujo. Revísalo cuando se cierre el issue #30560 de three y repite una prueba mínima con tu nivel.
- **Cambiar de compositor de postprocesado como primer paso.** Ayuda a la GPU; tu problema es CPU.
- **bitecs o cualquier ECS.** Reescribir la simulación compartida no baja ni un dibujo. Además bitecs es MPL-2.0 (copyleft por archivo): permite uso comercial pero obliga a publicar modificaciones de sus archivos.
- **Rapier o cannon-es para la rejilla.** Rapier pesa ≈816 KB gzip y cannon-es lleva ≈2 años sin publicar; tus colisiones propias ya funcionan en cliente y servidor.
- **three-pathfinding.** Última publicación en mayo 2024 según depscope y depende de three; un A\* sobre tu rejilla en `shared` es más ligero.
- **@three.ez/batched-mesh-extensions y @guestgd/three-sbml.** Versiones 0.0.x con muy poco uso; si necesitas culling por instancia o skinning, `@three.ez/instanced-mesh` (0.3.x, MIT) está más rodado.
- **uWebSockets.js, eiows y permessage-deflate ahora.** La red no es tu cuello de botella; uWebSockets.js no está en el registro npm y no verifiqué cómo convive con Express.
- **Draco en móviles de gama media.** Decodifica más lento que meshopt (de memoria, no medido); meshopt es el valor por defecto de gltf-transform v4.
- **Meter el juego web en Tauri esperando más fps.** En Windows WebView2 es Chromium igual que Chrome; en macOS y Linux cambia el motor y no hay garantía de que mejore.
- **r3f-perf y Tone.js.** El primero exige R3F; el segundo no ataca tu problema.

## Ejemplos mínimos de integración

Los tres primeros del Top 5, en TypeScript. No los he ejecutado contra tu proyecto: pruébalos en una rama y ajusta los nombres.

### 1. Sonda de fotograma: dibujos reales y CPU/GPU

Con EffectComposer, `renderer.info` solo ve la última pasada si `autoReset` está activo.

```ts
import Stats from 'stats-gl';
import type { WebGLRenderer } from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';

export function createFrameProbe(renderer: WebGLRenderer, composer: EffectComposer) {
  const stats = new Stats({ trackGPU: true, horizontal: true });
  stats.init(renderer);
  document.body.appendChild(stats.dom);
  renderer.info.autoReset = false; // con composer, info solo vería la última pasada

  let frames = 0, calls = 0, triangles = 0;
  return () => {
    renderer.info.reset();
    composer.render();
    stats.update();
    calls += renderer.info.render.calls;
    triangles += renderer.info.render.triangles;
    if (++frames === 120) { // media cada 120 fotogramas
      console.log(`dibujos/fotograma ${calls / frames}, triángulos ${triangles / frames}`);
      frames = calls = triangles = 0;
    }
  };
}
// uso: renderer.setAnimationLoop(createFrameProbe(renderer, composer));
```

Si `calls` cuadra con tus \~300 pero la CPU sigue en 14–18 ms, captura un fotograma con Spector.js y cuenta las llamadas GL de un dibujo cualquiera.

### 2. Visibilidad por portales entre habitaciones

Recorre las puertas desde la habitación del jugador y oculta el resto. Versión mínima: solo comprueba que cada portal esté dentro del frustum; recortar el frustum al pasar cada puerta culla más.

```ts
import { Box3, Camera, Frustum, Matrix4, Object3D } from 'three';

type Room = { group: Object3D; portals: { to: number; box: Box3 }[] };
const frustum = new Frustum();
const vp = new Matrix4();

export function updateVisibleRooms(rooms: Room[], camera: Camera, start: number, maxDepth = 3) {
  camera.updateMatrixWorld();
  vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(vp);

  const seen = new Set<number>([start]);
  const queue: [number, number][] = [[start, 0]];
  while (queue.length) {
    const [id, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;
    for (const p of rooms[id].portals) {
      if (!seen.has(p.to) && frustum.intersectsBox(p.box)) {
        seen.add(p.to);
        queue.push([p.to, depth + 1]);
      }
    }
  }
  rooms.forEach((r, i) => { r.group.visible = seen.has(i); });
}
```

El `box` de cada portal es la caja de la puerta o del hueco. Llama a la función una vez por fotograma, antes de renderizar.

### 3. BatchedMesh para decoración con un material

Un solo material; las texturas únicas por puerta requieren un `DataArrayTexture` con un índice por instancia (aparte de este ejemplo).

```ts
import { BatchedMesh, BoxGeometry, Matrix4, MeshStandardMaterial, Scene } from 'three';

export function buildDecor(scene: Scene, material: MeshStandardMaterial) {
  const geos = [new BoxGeometry(1, 0.4, 0.05), new BoxGeometry(1, 2.1, 0.08)]; // cartel, puerta
  const maxV = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  const maxI = geos.reduce((n, g) => n + (g.index?.count ?? 0), 0);

  const batch = new BatchedMesh(400, maxV, maxI, material);
  batch.sortObjects = false;            // evita ordenar por instancia en cada fotograma
  batch.perObjectFrustumCulled = false; // culling propio, por habitación
  const [signId, doorId] = geos.map((g) => batch.addGeometry(g));

  const m = new Matrix4();
  const place = (geoId: number, x: number, y: number, z: number) => {
    const id = batch.addInstance(geoId);
    batch.setMatrixAt(id, m.makeTranslation(x, y, z));
    return id;
  };
  place(doorId, 3, 1.05, 0);
  place(signId, 3, 2.4, 0.1);
  scene.add(batch);
  return { batch, place };
}
```

Todas las geometrías deben tener los mismos atributos. Para ocultar una habitación, usa `batch.setVisibleAt(id, false)` por instancia o agrupa por habitación en un BatchedMesh cada una.

## Dudas antes de recomendar nada más

1. **Navegadores y GPU objetivo.** ¿Firefox y Linux importan? Sin `WEBGL_multi_draw` (Firefox, y solo ≈65 % de los equipos Linux medidos), BatchedMesh no ahorra dibujos.
2. **Perfil de CPU del nivel -20.** ¿Puedes pasarme las 10 funciones con más tiempo propio de la pestaña Rendimiento de Chrome? Con eso sé si manda `renderBufferDirect`, `setProgram`, `projectObject` o `updateMatrixWorld`.
3. **Composición de los \~300 dibujos.** ¿Cuántos materiales y texturas distintos quedan, y cuántos dibujos son personajes, puertas, carteles y decoración?
4. **Parche `onBeforeCompile`.** ¿Tiene tests y anclas frágiles (reemplazos de `#include <…>`)? Eso decide si subir de 0.160 a r187 de una vez o por pasos.
5. **Personajes.** ¿Cuántos SkinnedMesh y cuántos huesos hay en pantalla a la vez?
6. **Escritorio.** ¿Solo Windows o también macOS y Linux? ¿Steam desde el principio?
7. **Licencias.** ¿Aceptas Zlib (postprocessing) y, en su caso, MPL-2.0 (bitecs) además de MIT, Apache-2.0 y BSD?
8. **Servidor.** ¿Jugadores por sala y frecuencia de tick? Solo importan si quieres atacar también la red.

## Fuentes y límites

Extractos devueltos por la búsqueda hasta el 15 nov 2026; solo abrí completa la ficha de @three.ez/batched-mesh-extensions. Las licencias marcadas «de memoria» no aparecían en lo que leí, y no obtuve tamaños gzip salvo el de Rapier.

- three.js: [manual de WebGPURenderer](https://threejs.org/manual/pages/webgpurenderer), [archivos de r187](https://sourceforge.net/projects/three-js.mirror/files/r187/), [r183: RenderPipeline y BatchedMesh](https://app.cinevva.com/pt-BR/news/2026-03-18-threejs-r183-render-pipeline), [PR #28404 (BatchedMesh instanciado)](https://www.github.com/mrdoob/three.js/pull/28404)
- Rendimiento medido por usuarios: [WebGPURenderer ≈2× CPU por dibujo (r183)](https://discourse.threejs.org/t/webgpurenderer-2x-slower-cpu-and-5-10x-slower-first-frame-than-webglrenderer-on-many-mesh-scenes-r183-same-on-both-backends/91904), [BatchedMesh con CPU alta](https://discourse.threejs.org/t/significant-performance-drop-and-high-cpu-usage-with-batchedmesh/67324)
- Soporte de navegadores: [WEBGL\_multi\_draw (web3dsurvey)](https://web3dsurvey.com/webgl/extensions/WEBGL_multi_draw), [caniuse](https://caniuse.com/wf-webgl-multi-draw), [WebGPU en 2026 (Utsubo)](https://www.utsubo.com/blog/frontier-web-apis-2026-production-ready)
- Paquetes de three: [@three.ez/instanced-mesh](https://packages.ecosyste.ms/registries/npmjs.org/packages/@three.ez%2Finstanced-mesh), [@three.ez/batched-mesh-extensions](https://www.npmjs.com/package/@three.ez/batched-mesh-extensions), [three-mesh-bvh](https://gkjohnson.github.io/tools/docs/three-mesh-bvh.md), [three-pathfinding (Snyk)](https://snyk.io/advisor/npm-package/three-pathfinding), [postprocessing](https://npmjs.com/package/postprocessing), [stats-gl](https://cdn.jsdelivr.net/npm/stats-gl@4.2.3/README.md), [Spector.js](https://github.com/BabylonJS/Spector.js)
- Build y assets: [@gltf-transform/cli 4.5.0](https://socket.dev/npm/package/@gltf-transform/cli/overview/4.5.0), [comandos de gltf-transform](https://gltf-transform.dev/cli), [guía de assets (terceros)](https://www.ui-skills.com/skills/cloudai-x/threejs-asset-pipeline), [vite-plugin-glsl](https://classic.yarnpkg.com/en/package/vite-plugin-glsl), [rollup-plugin-visualizer](https://classic.yarnpkg.com/en/package/rollup-plugin-visualizer)
- Red y física: [socket.io: instalación del servidor](https://socket.io/es/docs/v4/server-installation), [engine.io](https://github.com/socketio/engine.io), [msgpackr](https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/msgpackr), [snapshot-interpolation](https://classic.yarnpkg.com/en/package/@geckos.io/snapshot-interpolation), [bitecs (Snyk)](https://snyk.io/advisor/npm-package/bitecs), [Rapier (depscope)](https://depscope.dev/pkg/npm/@dimforge/rapier3d-compat), [cannon-es (Snyk)](https://dev.snyk.io/advisor/npm-package/cannon-es)
- Escritorio y audio: [flags de WebView2 (Microsoft)](https://learn.microsoft.com/microsoft-edge/webview2/concepts/webview-features-flags), [Tauri sobre WKWebView (foro de Babylon.js)](https://forum.babylonjs.com/t/performance-between-safari-and-wkwebview-tauri/60811), [steamworks.js](https://www.npmjs.com/package/steamworks.js), [Howler (Snyk)](https://snyk.io/advisor/npm-package/howler)
