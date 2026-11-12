# Caché de shaders persistente (idea de futuro: app de escritorio)

Estado: **no implementado**. Esta nota explica por qué no se puede en la web, qué se hizo en su lugar y cómo se retomaría si el juego se empaqueta como app de escritorio.

## Por qué no se puede en la web

- WebGL no expone el binario de un programa ya enlazado (no existe `getProgramBinary`), así que el juego no puede guardarlo en disco (IndexedDB, Cache API...) ni volver a cargarlo. Tampoco hay, hasta donde sabemos a fecha de esta nota, una API de caché de pipelines serializable en WebGPU: comprobarlo antes de decidir.
- Three.js solo genera el GLSL; lo caro es que el driver lo traduzca y lo enlace. Guardar el GLSL no ahorra eso.
- El navegador y el driver de la GPU suelen tener su propia caché en disco. Se activa sola; el juego no puede pedirla, limitarla ni ver su tamaño, y se pierde al actualizar navegador o driver, al limpiar datos o al cambiar el código de un shader.

## Lo que sí está hecho: ajuste SHADER WARM-UP

Ajustes > PERFORMANCE > SHADER WARM-UP (`settings.warmup`; se aplica al recargar). `game/compile.ts` lo lee una vez al arrancar:

| Valor | Qué hace |
|---|---|
| 2 · FULL (por defecto) | como siempre: precompila todo, también lo oculto, y espera a que el navegador termine |
| 1 · QUICK | solo lo visible (`traverseVisible`); lo oculto se compila la primera vez que se muestra |
| 0 · LAZY | no precompila nada: cada programa se compila al pintarse por primera vez, y el tirón cae en mitad de la partida (lo más notorio es Firefox, sin compilación en paralelo) |

En los tres modos siguen igual las pasadas de posprocesado de `game.ts` (con y sin VHS). En QUICK no se usa `compileAsync` (recorre la escena entera, también lo oculto): se espera a que `isReady()` de los programas ya pedidos.

Para medir: en desarrollo `compileGently` escribe `[compile] N programas, X ms bloqueando, Y ms en total (con/sin paralelo, modo)`.

## Idea de futuro: caché persistente en una app de escritorio

1. **Medir antes.** En Chrome normal, comparar la carga en frío con la segunda carga usando el log `[compile]`. Si la segunda ya es rápida, la caché del navegador ya hace el trabajo y la app aporta poco. Repetir en Firefox, que es donde más duele.
2. **Empaquetar.** Electron (Chromium fijo, mismo comportamiento en todos los equipos) o Tauri (en Windows usa WebView2, basado en Chromium; en macOS y Linux usa el WebKit del sistema, con otra caché y otros comportamientos). Para controlar la caché de GPU, Electron es lo directo.
3. **Qué se controlaría** (verificar contra la versión de Chromium que se use; los nombres cambian entre versiones):
   - Carpeta de datos del usuario fija (`app.setPath('userData', ...)`): la caché de GPU de Chromium vive dentro (carpetas tipo `GPUCache` / `ShaderCache`) y sobrevive entre ejecuciones.
   - Tamaño máximo con el interruptor de Chromium `gpu-disk-cache-size-kb` (`app.commandLine.appendSwitch`, antes de `app.whenReady()`).
   - No pasar `disable-gpu-shader-disk-cache`.
4. **Ajuste en la UI** (solo visible en escritorio): interruptor opt-in "PERSISTENT SHADER CACHE" (ocupa disco), con el tamaño usado y un botón "CLEAR CACHE". Hablaría con el proceso principal por IPC (preload + `contextBridge`) para medir y borrar la carpeta y guardar el límite. Los interruptores de Chromium se leen al arrancar, así que el cambio se aplicaría al reiniciar la app (como "APPLIES ON RELOAD").
5. **Limitaciones a tener presentes:**
   - La caché es por equipo y se invalida con cambios de GPU, driver o versión de Chromium; la primera ejecución en cada equipo siempre es lenta.
   - Se identifica por el código del shader: cambiar un shader o el número de luces la invalida (ver "Lights are fixed in number" en `ARCHITECTURE.md`). Mantener estable `customProgramCacheKey`.
   - Medir su tamaño real antes de fijar un límite por defecto.
6. **Lo que no hay que hacer:** guardar "shaders compilados" en IndexedDB o la Cache API desde la web (no hay nada que guardar) ni inventar una caché propia de GLSL.

Archivos relacionados: `client/src/settings.ts`, `client/src/game/Settings.tsx`, `client/src/game/compile.ts`, `client/src/game/still.ts`.
