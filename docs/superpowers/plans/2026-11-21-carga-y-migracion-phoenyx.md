# Carga rápida y Phoenyx como único motor — plan de implementación

> **Para quien ejecute:** usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que la web cargue y compile shaders mucho más rápido y que Phoenyx sea el único motor (se elimina three/WebGL).

**Arquitectura:** primero se mide y se inventaria; después se optimiza la carga (aplazar, partir el JS, caché, prioridad) y los shaders (`warm()` en el motor, menos variantes), se añade KTX2 y se limpia el paquete; por último se portan los huecos de three y se borra la ruta de three. Cada tarea deja el juego funcionando.

**Stack:** cliente React + Vite + three.js (alias a Phoenyx con `RENDERER=phoenyx`), motor `E:\phoenix` (Rust + WebGPU → WASM, paquete `packages/phoenyx`), servidor Node.

**Spec:** `docs/superpowers/specs/2026-11-21-carga-y-migracion-phoenyx-design.md` (aprobado). Léelo antes: tiene las líneas base medidas y las decisiones del dueño.

## Restricciones globales

- **Sin tests unitarios** (regla del proyecto). Cada paso se verifica con una **medida** o una **captura** (banco de fidelidad `E:\phoenix\tools\fidelity`, el navegador del panel o la consola), con el valor esperado escrito en el paso.
- Un commit por tarea terminada; mensajes en español; comentarios del código en español. En `E:\phoenix` los commits siguen sus reglas (un commit por función terminada).
- Se mide **solo en Chrome**; Firefox solo debe funcionar. Se mide con `RENDERER=phoenyx`.
- Metas aprobadas (se confirman al acabar la Tarea 1): menú < 5 MB descargados antes de ser interactivo, despliegue < 300 MB, ningún frame > 100 ms al entrar en una sala.
- El aspecto no cambia: toda tarea que toque el render compara capturas antes y después.
- Hasta la Tarea 12 los dos motores siguen en el repo y ninguna tarea debe romper la ruta de three.
- Memoria del proyecto: como mucho 2 subagentes a la vez; los revisores no usan Opus (usar sonnet).

## Review Focus (lo que ninguna tarea prueba por sí sola)

1. **Primera visita sin WebGPU:** debe salir `GpuNotice` sin errores en consola ni pantalla en blanco (Tarea 12).
2. **Despliegue nuevo con caché larga:** un cliente con la versión vieja en caché no puede quedarse con JS viejo y modelos nuevos; los nombres llevan hash o el manifiesto manda (Tarea 3).
3. **Objeto aplazado que se necesita de golpe** (recoger un objeto de ronda, abrir el personalizador, sacar el arma) no debe dar tirón ni objeto invisible (Tareas 2 y 4).
4. **Ajuste `warmup` guardado en `localStorage`** (`br-settings`): al borrar `compileGently` el valor viejo no debe romper la carga ni el menú de ajustes (Tarea 12).
5. **Iconos del inventario antes de que arranque la GPU:** hoy se pintan síncronos con `three-real`; con Phoenyx el renderer arranca asíncrono, así que no puede aparecer un icono en blanco ni lanzar una excepción (Tarea 10).

## Estructura de archivos

- Crear: `client/src/perf.ts` (marcas y recuento de programas, solo desarrollo), `docs/perf/baseline.md` (tabla de cifras), `docs/superpowers/specs/2026-11-21-inventario-three.md` (huecos).
- Modificar: `client/src/game/game.ts` (`loadAssets`, llamadas a `compileGently`), `client/src/game/itemModels.ts`, `client/src/game/cosmetics.ts`, `client/vite.config.ts`, `client/src/game/compile.ts`, `E:\phoenix\packages\phoenyx\src\renderer.ts` (y lo que haga falta en `crates/phoenyx-gl`), `tools/pack_glb.py`, `client/src/game/InvAvatar.tsx`, `Computer.tsx`, `invIcons.ts`, `client/src/dev/anim/Studio.tsx`.

---

### Tarea 1: Línea base en Phoenyx

**Archivos:** crear `client/src/perf.ts`, `docs/perf/baseline.md`.

**Interfaces:**
- Produce: `perf.mark(name: string): void` y `perf.report(): Record<string, number>` (ms desde el arranque de la página); `window.__perf` en desarrollo. Cifras de referencia que usan todas las tareas siguientes.

- [ ] **Paso 1:** crear `perf.ts` con `mark`/`report` (usa `performance.mark`), sin coste en producción (`import.meta.env.DEV`). Añadir marcas en `loadAssets` (inicio/fin de modelos y texturas), cada `compileGently` (inicio/fin, nº de programas) y la pantalla de menú lista.
- [ ] **Paso 2:** medir con `RENDERER=phoenyx` en una build de producción servida en local (Chrome): bytes antes del menú, bytes tras ENTER, tiempo y nº de pipelines del lobby, frames > 100 ms al entrar en una sala, y la carga de un nivel (ronda) que faltaba. Esperado: una tabla completa con todas esas filas.
- [ ] **Paso 3:** escribir `docs/perf/baseline.md` con la tabla y el procedimiento exacto (comandos y pasos de UI). Confirmar con el dueño las metas numéricas si las cifras de Phoenyx cambian mucho respecto a las de three.
- [ ] **Paso 4:** commit `Medicion: linea base de carga y pipelines en Phoenyx`.

### Tarea 2: Inventario de huecos de three (paralelizable con la 1)

**Archivos:** crear `docs/superpowers/specs/2026-11-21-inventario-three.md`.

**Interfaces:** produce la lista de huecos con prioridad que consumen las Tareas 9–11.

- [ ] **Paso 1:** `grep` completo de `WebGLRenderer`, `onBeforeCompile`, `ShaderMaterial`, `RawShaderMaterial`, `Reflector`, `DecalGeometry`, `RectAreaLightUniformsLib` y de lo importado de `three/examples` en `client/src`, separando uso real de uso solo de tipo.
- [ ] **Paso 2:** para cada uso, comprobar contra `E:\phoenix\packages\phoenyx\src` (`patches.ts`, `user-shaders/`, `post-shaders.ts`, `renderer.ts`) si hay versión WGSL/soporte. Marcar: portado / hueco / límite del motor (transparencias en mallas, un material por modelo, UV fuera de [0, 1]).
- [ ] **Paso 3:** escribir el documento con una fila por hueco: archivo, qué hace, estado, coste estimado, prioridad. Esperado: ningún uso de la lista del paso 1 sin fila.
- [ ] **Paso 4:** commit `Inventario: usos de three que faltan por portar a Phoenyx`.

### Tarea 3: Caché de larga duración con hash

**Archivos:** modificar `client/vite.config.ts` y la configuración de servidor/despliegue que sirva la web (localizar quién la sirve: servidor Node, Vercel o ambos).

**Interfaces:** produce cabeceras `Cache-Control: public, max-age=31536000, immutable` en `/assets/*` (ya llevan hash) y caché revalidable en `/models/*`, `/animations/*` con un identificador de versión en el manifiesto (`models/packs/manifest.json`).

- [ ] **Paso 1:** localizar cómo se sirve en producción y qué cabeceras salen hoy (anotarlo en `docs/perf/baseline.md`).
- [ ] **Paso 2:** poner las cabeceras de arriba; el manifiesto de packs no se cachea (`no-cache`) y lleva la versión de cada pack, de modo que un modelo cambiado cambie de URL o de ETag.
- [ ] **Paso 3:** verificar en Chrome (Red → segunda carga): `/assets/*` y modelos salen de caché de disco (0 B transferidos) y el menú es interactivo sin esperar descargas. Esperado: segunda carga con < 100 KB transferidos y manifiesto revalidado.
- [ ] **Paso 4:** commit `Cache: assets con hash inmutables y manifiesto de versiones`.

### Tarea 4: Aplazar lo que el menú no necesita

**Archivos:** `client/src/game/game.ts` (`loadAssets`), `client/src/game/itemModels.ts`, `client/src/game/cosmetics.ts`, `client/vite.config.ts` (paquete `core`).

**Interfaces:**
- Produce `ensureItemModels(names?: string[]): Promise<void>` y `preloadCosmetics(ids: string[]): Promise<void>`; `loadAssets` ya no descarga objetos de ronda, cosméticos ni kits de niveles bloqueados.
- Consume `perf.mark` (Tarea 1).

- [ ] **Paso 1:** sacar `loadItemModels()` y la precarga de los 16 cosméticos de `loadAssets`; que carguen bajo demanda (primer uso) con `ensure*`, que devuelven la misma promesa si ya está pedido.
- [ ] **Paso 2:** tras pintar el menú, precargar en segundo plano (prioridad baja, un archivo cada vez) lo que el lobby y el personalizador van a necesitar. El personalizador y el lobby cuentan como menú: sus cosméticos y objetos actuales cargan antes de mostrarlos.
- [ ] **Paso 3:** comprobar los kits de niveles bloqueados: no se descargan hasta desbloquear o votar el nivel (el paquete `core` de `vite.config.ts` ya separa por nivel; confirmar y completar).
- [ ] **Paso 4:** verificar en Chrome: bytes hasta el menú. Esperado: menos de 5 MB (meta) o la mayor reducción posible con la lista de lo que queda; abrir el personalizador y recoger un objeto no provoca frames > 100 ms (Review Focus 3).
- [ ] **Paso 5:** commit `Carga: el menu ya no descarga objetos, cosmeticos ni kits de niveles`.

### Tarea 5: Partir el JS principal y carga por prioridad

**Archivos:** `client/vite.config.ts` (`build.rollupOptions.output.manualChunks`), `client/src/game/game.ts`.

**Interfaces:** produce fragmentos separados: arranque/menú, motor (Phoenyx + three-exports), juego (niveles), y orden de descarga LOD bajo → resto.

- [ ] **Paso 1:** comprobar si el JS principal (1,98 MB) se descarga dos veces en producción con caché real (visto en la medición con un servidor sin caché; si es del servidor de prueba, anotarlo y seguir).
- [ ] **Paso 2:** `manualChunks`: separar el motor y las librerías grandes del código del juego; cargar el nivel y lo que no se ve en el menú con `import()`.
- [ ] **Paso 3:** carga por prioridad: LOD bajo de cada modelo primero (`loadLods`), el resto después del primer fotograma jugable; lo no visible al empezar, tras el primer fotograma.
- [ ] **Paso 4:** verificar con una build de producción: JS inicial < 1 MB comprimido (o el valor que dé la Fase 0) y el menú pinta antes que antes. Esperado: tabla comparada con `baseline.md`.
- [ ] **Paso 5:** commit `Carga: JS partido y descarga por prioridad`.

### Tarea 6: `warm()` en el motor y sustituir `compileGently`

**Archivos:** `E:\phoenix\packages\phoenyx\src\renderer.ts` (y `crates/phoenyx-gl` si hace falta), `client/src/game/compile.ts`, `client/src/game/game.ts` (5 llamadas), `client/src/game/still.ts`.

**Interfaces:**
- Produce `renderer.warm(scene: Scene, camera: Camera, opts?: { budgetMs?: number; onProgress?: (f: number) => void; signal?: AbortSignal }): Promise<void>`: crea los pipelines que la escena va a necesitar, repartidos por fotogramas con ese presupuesto (por defecto 4 ms), incluidos los objetos ocultos, y resuelve cuando todos están listos.
- Consume nada anterior; las llamadas del cliente cambian de `compileGently(r, scene, cam, around, progress)` a `warm`.

- [ ] **Paso 1:** en el motor, implementar `warm` recorriendo la escena (también lo oculto) y pidiendo la creación asíncrona de pipelines (`createRenderPipelineAsync`) con presupuesto por fotograma; devolver progreso real (pipelines listos / pedidos). Commit en `E:\phoenix`: `warm(): precompila pipelines de una escena con presupuesto por fotograma`.
- [ ] **Paso 2:** sustituir las llamadas a `compileGently` en `game.ts` (líneas ~1077, 2171, 2187, 3237, 3416) por `warm`; mantener el comportamiento actual de "pantalla quieta" solo si hace falta con WebGPU (en WebGPU la creación de pipelines asíncrona no bloquea el hilo).
- [ ] **Paso 3:** compilar durante el lobby y la entrada (11,5 s): llamar `warm` del nivel que viene (`warmLevel`) con presupuesto bajo mientras la secuencia corre.
- [ ] **Paso 4:** verificar: frames > 100 ms al entrar en una sala y al empezar el nivel. Esperado: ninguno (meta).
- [ ] **Paso 5:** commit en el repo del juego: `Shaders: warm() del motor sustituye a compileGently y calienta el nivel durante la entrada`.

### Tarea 7: Menos variantes de materiales y pipelines

**Archivos:** los que creen materiales duplicados (inventario: `world.ts`, `parking.ts`, `poolmap.ts`, `waiting*.ts`, `items*`, `cosmetics.ts`).

**Interfaces:** produce un registro de materiales compartidos (`sharedMaterial(key, factory)`) que devuelve el mismo material para la misma configuración.

- [ ] **Paso 1:** con `perf.report()` listar los pipelines por nombre y repetición (en la medición, `glass` salía ×8 y varios ×4); decidir qué se unifica (mismo tipo con distinto color/mapa → uno con parámetros).
- [ ] **Paso 2:** unificar, empezando por los más repetidos; comparar capturas del banco de fidelidad antes y después.
- [ ] **Paso 3:** verificar: nº de pipelines del lobby. Esperado: al menos un 30 % menos que en `baseline.md` sin diferencias de captura.
- [ ] **Paso 4:** commit `Shaders: materiales compartidos para reducir pipelines duplicados`.

### Tarea 8: Texturas en KTX2/Basis

**Archivos:** `E:\phoenix\packages\phoenyx\src\textures.ts` (cargador), `E:\phoenix\crates\phoenyx-bake` (si el bake escribe texturas), `tools/pack_glb.py`, `client/src/game/game.ts` (`TEXTURES`).

**Interfaces:** produce un cargador `loadKTX2(url): Promise<Texture>` del motor (decodifica Basis a un formato comprimido de GPU soportado: BC7/ASTC/ETC2 según el dispositivo) y un paso de build que genera `.ktx2` desde las texturas del juego.

- [ ] **Paso 1:** añadir el soporte KTX2/Basis al motor (decodificador WASM de Basis, elección de formato por `GPUDevice.features`); commit en `E:\phoenix`.
- [ ] **Paso 2:** paso de build en `tools/pack_glb.py` (o un script nuevo) que convierta texturas a `.ktx2` con mipmaps; empezar por las mayores (las de `tex/` y las de `models/`).
- [ ] **Paso 3:** cargar `.ktx2` en el cliente cuando existan (con respaldo al `.webp`, que se retira en la Tarea 12 si ya no hace falta).
- [ ] **Paso 4:** verificar: tamaño de descarga y memoria de GPU de un nivel antes/después; captura de fidelidad sin diferencias visibles. Esperado: menos bytes y menos VRAM que `baseline.md`.
- [ ] **Paso 5:** commit del juego: `Texturas: KTX2/Basis para las texturas del juego`.

### Tarea 9: Paquete de despliegue limpio

**Archivos:** `client/vite.config.ts` (`publicDir`/`closeBundle`), `.gitignore` si hace falta.

- [ ] **Paso 1:** excluir del build los `.zip` fuente de `public/` y lo que no se use (`public/animations` sin empaquetar si solo se sirve el pack; comprobar con `animPack()` qué se emite).
- [ ] **Paso 2:** construir y medir el tamaño de la salida. Esperado: < 300 MB (meta); si no, listar qué falta quitar.
- [ ] **Paso 3:** comprobar que `tools/*.py` y `assets-src` no dependen de que los zips estén en `public/`.
- [ ] **Paso 4:** commit `Paquete: el despliegue deja fuera los zip de modelos fuente`.

### Tarea 10: Portar los huecos de render (uno por commit)

**Archivos:** según `docs/superpowers/specs/2026-11-21-inventario-three.md` (Tarea 2).

**Interfaces:** consume la lista de huecos; produce Phoenyx cubriendo cada uno.

- [ ] **Paso 1:** ordenar los huecos por prioridad. Para cada uno: portar (WGSL / gancho / API del motor) o decidir si se amplía el motor o se cambia el asset (transparencias en mallas, un material por modelo, UV fuera de [0, 1]).
- [ ] **Paso 2:** por cada hueco: captura antes y después con el banco de fidelidad; sin diferencias visibles; commit `Phoenyx: <hueco> portado`. (En `E:\phoenix` los cambios del motor van en su repo, un commit por función.)
- [ ] **Paso 3:** `WebGLRenderer` sueltos: `InvAvatar.tsx`, `Computer.tsx`, `invIcons.ts` (hoy síncrono con `three-real`; con Phoenyx, pintar de forma asíncrona y no mostrar un icono en blanco mientras no esté, ver Review Focus 5) y `dev/anim/Studio.tsx` (incluye el panel de agarres). Migrar cada uno al renderer de Phoenyx (segunda vista o canvas fuera de pantalla).
- [ ] **Paso 4:** verificar cada nivel (0, parking, poolrooms, suites) y el lobby en Chrome con `RENDERER=phoenyx`: sin errores en consola, aspecto igual. Esperado: ninguna advertencia `[phoenyx] ... sin version WGSL` en consola.

### Tarea 11: Verificación previa a quitar three

- [ ] **Paso 1:** pasar el banco de fidelidad completo y las mediciones de `baseline.md`; comparar todas las metas (menú < 5 MB, despliegue < 300 MB, sin frames > 100 ms). Esperado: metas cumplidas o una lista de las que no, con su causa.
- [ ] **Paso 2:** revisar manualmente los cuatro niveles y el estudio de animación.
- [ ] **Paso 3:** commit de lo que se corrija (`Verificacion: ...`).

### Tarea 12: Quitar three

**Archivos:** `client/vite.config.ts`, `client/package.json`, `client/src/game/compile.ts` (borrar), `client/src/settings.ts`, `client/src/GpuNotice.tsx`, todo el código con `__PHOENYX__`.

- [ ] **Paso 1:** borrar `RENDERER=phoenyx` como variable (Phoenyx pasa a ser lo único), los alias de `three-real` y la dependencia `three` si nada la importa; resolver las importaciones `three` que Phoenyx ya re-exporta (la API sigue siendo la de three; no se renombran).
- [ ] **Paso 2:** eliminar las ramas `__PHOENYX__ ? ... : ...` (hoy 9 usos en 8 archivos) y `compile.ts`.
- [ ] **Paso 3:** `settings.warmup`: dejar de usarlo y migrar el valor guardado sin romper el menú de ajustes (Review Focus 4).
- [ ] **Paso 4:** sin WebGPU: `GpuNotice` sin errores en consola (Review Focus 1); verificar con WebGPU desactivado.
- [ ] **Paso 5:** `npx tsc --noEmit` limpio, build de producción correcta; las mediciones finales en `baseline.md` (columna "después").
- [ ] **Paso 6:** commit `Motor: Phoenyx es el unico motor; se elimina three y la ruta WebGL`.

---

## Autorrevisión

- Cobertura del spec: objetivos 1–5 → Tareas 4–5 (carga), 6–7 (shaders), 8–9 (texturas y paquete), 10–12 (migración); caché y prioridad → Tareas 3 y 5; línea base e inventario → Tareas 1–2.
- La Tarea 10 depende del inventario: sus pasos son genéricos a propósito, porque la lista de huecos todavía no existe.
- `warm()` se define una sola vez (Tarea 6) y las demás tareas solo lo usan.
