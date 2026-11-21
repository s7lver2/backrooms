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
| Tras ENTER, hasta el menú | ~21 MB | ~20,4 MB (objetos 8,4 · cosméticos 3,6 · animaciones 3,1 · LODs 1,9 · JS/CSS 1,7 · nivel 1,0 · wasm 0,6 · marca 0,1) |
| Programas / pipelines tras el lobby | 163 (53 en la pasada del lobby, 406 ms bloqueando, 906 ms) | sin contador accesible |
| Frames > 80 ms al pulsar NORMAL | 279–843 ms en ~2 s | frames de 300–600 ms continuos en 10 s |
| FPS del lobby en el panel | ~30 (33 ms) | ~9 |
| Despliegue (`public/` copiado) | 1,4 GB | 1,4 GB |

## Notas
- El panel tiene el preset POTATO (`warmup: 0`); con `warmup: 2` se midieron las cifras de three del lobby.
- En Phoenyx el lobby va a ~9 fps en el panel: hay que ver si es el panel (ventana en segundo plano/GPU) o el motor antes de usarlo como referencia de "sin tirones".
- Phoenyx se midió con el mismo preset POTATO del panel (`warmup: 0`); las cifras de three del lobby se tomaron con `warmup: 2`, así que FPS y frames largos no son del todo comparables.
- Frames largos: umbral de 80 ms (no 100) al pulsar NORMAL. Los bytes «antes del menú» (hasta ENTER) son solo JS+CSS (741 KB + 146 KB en Phoenyx).
- Sin medir: carga de un nivel (ronda) en Phoenyx, Firefox.
