# Carga rápida y Phoenyx como único motor — diseño

Estado: borrador para aprobar. Fecha: 2026-11-21.

## Intención y por qué

El juego tarda en cargar (la web, el lobby, los niveles) y en compilar shaders, y mantiene dos motores a la vez: three.js (WebGL) y Phoenyx (WebGPU, misma API). Se quiere que cargue más rápido y que Phoenyx sea el único motor, sin la ruta de three. Mantener dos rutas duplica el trabajo de shaders, de compilación y de pruebas.

## Qué se midió (línea base)

Medido en Chrome local, RTX 4070, con la ruta de three. Los tiempos locales no valen para red real; se usan tamaños.

- **Carga de la web:** JS principal 1,98 MB (~687 KB comprimido) + 421 KB (~146 KB) + CSS 91 KB. Primer pintado 312 ms; sin tareas largas.
- **Al pulsar ENTER (hasta el menú), ~21 MB más:** objetos 8,4 MB (12 archivos), cosméticos 3,6 MB (16), paquete de animaciones 3,1 MB, JS/CSS diferido 2,6 MB, LODs de Phoenyx 2,0 MB (177 archivos), modelos del nivel 1,0 MB.
- **Lobby con calentamiento completo:** 53 programas, 406 ms bloqueando, 906 ms en total (Chrome, compilación en paralelo); 163 programas tras cargar; la entrada no compila nada nuevo. En Firefox cada programa cuesta ~0,4 s.
- **Tirones al entrar en una sala:** frames de 279–843 ms durante ~2 s (carga + compilación).
- **Duplicados:** varios materiales aparecen 4–8 veces en la lista de programas (`glass` ×8).
- **Despliegue:** `public/` ocupa 1,4 GB: 422 MB de animaciones, ~560 MB de `.zip` de modelos fuente, 105 MB de modelos.
- **Sin medir todavía:** carga de un nivel (ronda), Firefox, red real, producción con caché.

## Objetivos

1. Reducir lo que se descarga hasta ver el menú: aplazar todo lo que el menú no necesita (objetos de ronda, cosméticos, kits de niveles bloqueados).
2. Partir el JS principal para pintar antes.
3. Reducir los programas de shader únicos y los tirones al entrar en una sala y al cargar un nivel.
4. Texturas más pequeñas (KTX2/Basis o el formato de Phoenyx) y un paquete de despliegue limpio (sin `.zip` fuente).
5. Phoenyx es el único motor: se borran el alias de three, `three-real`, la ruta WebGL y el calentamiento de shaders propio de three. Sin WebGPU aparece el aviso que ya existe (`GpuNotice`).

## No-objetivos

- No se cambia el aspecto del juego (se comprueba con el banco de fidelidad de Phoenyx: `E:/phoenix/tools/fidelity`, con referencias en `E:/phoenix/fidelity`).
- No se mantiene un respaldo WebGL.
- No se crea un streaming de texturas ni un sistema de paquetes nuevo.
- No se hornean los iconos del inventario en el build (queda el renderer de Phoenyx para ellos).

## Antiobjetivos (cuenta como fallo aunque funcione)

- Un aspecto peor o más oscuro que el actual en cualquier nivel.
- Tirones nuevos al entrar en una sala, al abrir el personalizador o al sacar un objeto.
- Romper el juego en una rama intermedia durante la migración.

## Restricciones

- Las reglas del proyecto: sin tests unitarios (se verifica con capturas y medidas), un commit por función terminada, comentarios en español.
- Límites actuales de Phoenyx: solo WebGPU, un material por modelo, sin transparencias en mallas ni UI, luces puntuales sin sombra (máximo 4 focos con sombra), UV dentro de [0, 1].
- Hasta que se complete la migración, los dos motores siguen en el repo y los cambios no deben romper ninguno.

## Enfoques considerados

1. **Por etapas (elegido).** Optimizar primero sobre Phoenyx (único motor), inventariar los huecos de portado, portar por prioridad y, al final, borrar three. Commits independientes, cada uno con la fidelidad comprobada. Coste: más lento al final; ventaja: el juego no se rompe y se mide el efecto de cada paso.
2. **Todo de golpe.** Quitar three y arreglar lo que se rompa. Más rápido en teoría, pero deja el juego roto mucho tiempo y mezcla fallos de migración con los de optimización.
3. **Por etapas con iconos horneados.** Igual que la 1, con los iconos del inventario generados en el build. Descartado por el usuario: los iconos siguen usando el renderer de Phoenyx.

Elegido por el usuario: el enfoque 1.

## Diseño

### Fase 0 — Medir bien (antes de tocar nada)
- Pasar la medición a Phoenyx (WebGPU). Los números de arriba son de la ruta de three y las compilaciones de WebGPU son otro coste (pipelines).
- Medir: carga de un nivel, tirones, nº de pipelines por nivel, y la web en producción con caché.
- Entregable: una tabla de referencia en el repo con las cifras de salida de cada fase.

### Fase 1 — Carga inicial
- Aplazar la descarga de objetos de ronda, cosméticos y kits de niveles hasta que se necesiten (el paquete `core` de `vite.config.ts` ya separa por niveles; los cosméticos y objetos hay que sacarlos del arranque).
- Partir el JS principal (separar el motor y la lógica de juego del menú).
- Comprobar que el JS principal no se descarga dos veces (visto en la medición; puede ser solo el servidor de prueba sin caché).
- Objetivo: reducir el tráfico previo al menú a una fracción de los ~21 MB actuales; el valor lo fija la Fase 0.

### Fase 2 — Shaders y pipelines en Phoenyx
- Reducir variantes duplicadas de materiales/pipelines (mismo tipo con distinto color o mapa → uno solo con parámetros).
- Compilar en los tiempos muertos: la entrada del lobby dura 11,5 s y el menú tiene ratos parados; calentar el nivel que viene con presupuesto por fotograma.
- Que Phoenyx exponga un `warm(escena, { presupuestoMs })` con progreso real, que sustituya a `compileGently`.
- Objetivo: sin frames > 100 ms al entrar en una sala; el nivel carga sin tirones al empezar.

### Fase 3 — Paquete y texturas
- Sacar los `.zip` fuente (~560 MB) y lo que no se use de `public/` del despliegue.
- Texturas en KTX2/Basis o en el formato de Phoenyx (pendiente de decidir según lo que soporte el motor).
- Objetivo: despliegue de una fracción de 1,4 GB.

### Fase 4 — Inventario de huecos de three
Para cada uso, anotar si Phoenyx ya lo cubre. Lo que ya se sabe:
- **Portado (hay versión WGSL):** `onBeforeCompile` de materiales estándar, polvo, agua, vents, VHS, charcos y atmósfera del parking, `Reflector`, Bloom, GTAO, SMAA, Output.
- **Por comprobar:** 5 parches (`cosmetics`, `lightmap`, `parking` ×2, `poolmap`) y 9 `ShaderMaterial` (cielo, rayos de luz, vents, `waterjet`, remotos, atmósfera, polvo…); `DecalGeometry`; `RectAreaLightUniformsLib`.
- **Three de verdad hoy:** `WebGLRenderer` propios en `InvAvatar`, `Computer.tsx`, `invIcons` (vía `three-real`) y el estudio de animación de desarrollo.
- Entregable: lista de huecos con prioridad y coste.

### Fase 5 — Portar los huecos
- Portar por prioridad, un hueco por commit, con captura de fidelidad antes y después.
- Reemplazar los `WebGLRenderer` sueltos por el renderer de Phoenyx (una segunda vista o un canvas fuera de pantalla).
- Donde el límite del motor (transparencias en mallas, un material por modelo, UV fuera de [0, 1]) impida portar, decidir caso por caso: ampliar el motor o cambiar el asset.

### Fase 6 — Quitar three
- Borrar el alias de `three` en `vite.config.ts`, `three-real`, `RENDERER=phoenyx` (pasa a ser lo único), el código de `__PHOENYX__ ? … : …`, `compile.ts` (calentamiento de three) y la dependencia `three` si ya nada la importa.
- Mantener las importaciones `three` que Phoenyx re-exporta solo si la API sigue siendo la de three; valorar renombrarlas más adelante (fuera de alcance).
- Sin WebGPU: `GpuNotice` explica que hace falta.

## Verificación
- Capturas del banco de fidelidad (`E:/phoenix/tools/fidelity`; el que construya documenta cómo se ejecuta y qué escenas cubre) antes y después de cada cambio de render.
- Mediciones de carga con el mismo método de la línea base.
- Revisión manual de cada nivel (0, parking, poolrooms, suites) y del lobby tras la Fase 5 y 6.

## Decisiones tomadas por mí (a revisar)
- **Ruta de medida y de producción:** se mide con `RENDERER=phoenyx`; la Fase 0 comprueba qué construye hoy `vercel-build.sh` y deja anotado qué ruta es la de producción durante la migración.
- **Orden:** el inventario de huecos (Fase 4) se hace en paralelo a la Fase 0, antes de dar por buenas las cifras de las fases 1–3.
- **Precarga:** lo aplazado (cosméticos, objetos, kits) se precarga en segundo plano tras pintar el menú, con prioridad baja y sin tirones; el personalizador y el lobby cuentan como parte del menú.
- **`warm()`:** asíncrono, con callback de progreso (0–1), repartido por fotogramas con presupuesto en ms.
- **Paquete limpio:** los `.zip` fuente se excluyen del build (no se borran del repo ni se mueven).
- **Inventario:** la lista de `WebGLRenderer` es incompleta; la Fase 4 empieza con un `grep` completo y distingue usos de tipo de usos reales.

## Decisiones del dueño (2026-11-21)
- Metas numéricas aprobadas: menú < 5 MB, despliegue < 300 MB, ningún frame > 100 ms al entrar en una sala (se confirman tras la Fase 0).
- `E:\phoenix` se puede modificar libremente (con sus reglas de commits) para lo que haga falta: `warm()`, cargador KTX2/Basis, huecos de render.
- Solo se mide en Chrome; Firefox queda como "funciona".
- KTX2/Basis se añade al motor (Fase 3, ya no depende de si el motor lo soporta).
- El estudio de animación (`src/dev/anim`, que incluye el panel de agarres de la antigua `/?grips`) se migra a Phoenyx.
- Se aplican todas las optimizaciones propuestas, incluidas dos que faltaban en las fases: caché de larga duración con hash (HTTP o service worker) para que la segunda carga sea casi instantánea, y carga por prioridad (LOD bajo primero, lo no visible al empezar después del primer fotograma jugable).

## Quedan a criterio del que construya
- Cómo partir el JS (qué va en cada fragmento).
- El formato de texturas de la Fase 3.
- La forma exacta de `warm()` en el motor y cómo el cliente lo usa.
- Qué hacer con cada hueco de la Fase 4 si el motor no lo soporta (ampliar motor o cambiar asset).

## Riesgos
- Que portar un hueco (p. ej. el cielo o el agua) cambie el aspecto: por eso cada uno lleva su captura de fidelidad.
- Que WebGPU no esté disponible en equipos de algunos jugadores: es una decisión ya tomada.
- Los números medidos son de la ruta de three; pueden cambiar bastante en Phoenyx (Fase 0 lo confirma).
