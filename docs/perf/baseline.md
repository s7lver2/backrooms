# Línea base de carga (2026-11-21)

Chrome en el panel de la app, RTX 4070, build de producción servida con `vite preview` (con compresión), `RENDERER=phoenyx`
salvo donde se indica. Las marcas de `perf.ts` solo existen en desarrollo; en producción se mide con la Performance API.

## Procedimiento
1. `cd client && RENDERER=phoenyx npx vite build --outDir /tmp/br-phx --emptyOutDir`
2. `RENDERER=phoenyx npx vite preview --outDir /tmp/br-phx --port 5196 --strictPort` (el servidor de juego en 5181).
3. Abrir `http://localhost:5196/`, CONTINUE (aviso del motor), aceptar condiciones, ENTER; leer `performance.getEntriesByType('resource')`
   (el búfer llega a 250 entradas: subir con `performance.setResourceTimingBufferSize` si hace falta) y frames > 80 ms con un `requestAnimationFrame`.

## Cifras
| Qué | three (WebGL) | Phoenyx (WebGPU) |
|---|---|---|
| JS principal (comprimido) | 687 KB (+146 KB diferido) | 741 KB (+146 KB diferido) |
| WASM del motor | — | 571 KB |
| Hasta ver el menú (carga real) | ~21 MB (medido mal, ver nota) | **35,6 MB**: nivel/props 17,3 · objetos 8,4 · kit Poolrooms 4,2 · animaciones 3,1 · LODs 1,2 · JS/CSS 0,8 · wasm 0,6 |
| Tras la Tarea 4 (suites, objetos y kit Poolrooms aplazados) | — | **13,8 MB** (props 8,1 · animaciones 3,1 · LODs 1,2 · JS 0,8 · wasm 0,6); lo aplazado (~22 MB) baja con el menú ya abierto |
| Programas / pipelines tras el lobby | 163 (53 en la pasada del lobby, 406 ms bloqueando, 906 ms) | sin contador accesible |
| Frames > 80 ms al pulsar NORMAL | 279–843 ms en ~2 s | frames de 300–600 ms continuos en 10 s |
| FPS del lobby en el panel | ~30 (33 ms) | ~9 |
| Despliegue (`public/` copiado) | 1,4 GB | 1,4 GB |

## Notas
- **Corrección:** las medidas «tras ENTER» anteriores (~20 MB: objetos, cosméticos, animaciones…) eran el paquete `core` instalándose en segundo plano (`setTimeout(autoInstall, 20000)` en `main.tsx`), no la carga del menú. La carga real del menú es la fila de arriba y se mide antes de los 18 s de la página.
- El panel tiene el preset POTATO (`warmup: 0`); con `warmup: 2` se midieron las cifras de three del lobby.
- En Phoenyx el lobby va a ~9 fps en el panel: hay que ver si es el panel (ventana en segundo plano/GPU) o el motor antes de usarlo como referencia de "sin tirones".
- Phoenyx se midió con el mismo preset POTATO del panel (`warmup: 0`); las cifras de three del lobby se tomaron con `warmup: 2`, así que FPS y frames largos no son del todo comparables.
- Frames largos: umbral de 80 ms (no 100) al pulsar NORMAL. Los bytes «antes del menú» (hasta ENTER) son solo JS+CSS (741 KB + 146 KB en Phoenyx).
- Sin medir: carga de un nivel (ronda) en Phoenyx, Firefox.
