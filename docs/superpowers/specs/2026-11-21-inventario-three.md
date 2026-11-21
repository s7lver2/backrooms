# Inventario: qué sigue usando three (2026-11-21)

Fuente: `grep` en `client/src` y comparación con `E:\phoenix\packages\phoenyx\src` (`patches.ts`, `user-shaders/`, `post-shaders.ts`, `renderer.ts`).
Con la build de Phoenyx el alias `three` ya apunta al motor: lo que sigue siendo three de verdad es solo `three-real` (WebGL) y lo que se ejecuta fuera del renderer del motor.

## Resumen
- **Cubierto por Phoenyx:** los 5 `onBeforeCompile` (hay 5 parches registrados), los `ShaderMaterial` de polvo, cielo, rayos, alfombra, agua, charcos, vents, atmósfera del parking, `waterjet` y remotos (hay 13 shaders de usuario portados), `Reflector`, Bloom, GTAO, SMAA y Output, `DecalGeometry` (solo geometría) y `OrbitControls` (solo JS).
- **Hueco real: renderers WebGL secundarios** (8 sitios). Con Phoenyx cada `WebGLRenderer` abre su propio dispositivo WebGPU y el render es asíncrono; por eso hoy dos de ellos usan `three-real`.
- **Nota:** también están portados `vhs` y `dust-cam` (entre los 13 shaders).
- **Por comprobar con captura:** la paridad visual de cada parche y shader portado (que existan no prueba que se vean igual).

## Huecos (por prioridad)
| # | Archivo | Qué hace | Estado | Acción | Coste |
|---|---|---|---|---|---|
| 1 | `game/invIcons.ts` | Pinta los iconos del inventario síncronos con `three-real` (`preserveDrawingBuffer`) | Hueco: three de verdad | Pintar con el renderer del motor de forma asíncrona (o un único renderer compartido) y no mostrar iconos en blanco mientras no estén | Medio |
| 2 | `game/wardThumbs.ts` | Miniaturas del vestuario con `three-real` | Hueco: three de verdad | Igual que el 1 (comparten renderer) | Medio |
| 3 | `game/ItemView.tsx` | Visores 3D de ficha con un pozo de `WebGLRenderer` (con Phoenyx, una GPU por visor) | Funciona, pero un dispositivo por visor | Un renderer del motor compartido y varias vistas | Medio |
| 4 | `game/InvAvatar.tsx` | Avatar del inventario con un renderer compartido | Igual que el 3 | Reutilizar el compartido | Bajo |
| 5 | `game/Computer.tsx` | Ordenador del lobby con su canvas y renderer | Igual que el 3 | Reutilizar el compartido | Bajo |
| 6 | `dev/anim/Studio.tsx` (×2: línea 85 y 393) | Estudio de animación y panel de agarres de desarrollo | Dos `WebGLRenderer` propios (uno con `preserveDrawingBuffer`) | Migrar al renderer del motor (decidido por el dueño) | Medio |
| 7 | `game/poolmap.ts` | `RectAreaLightUniformsLib.init()` (tablas LTC de las luces de área) | **No se puede quitar**: `phoenyx/src/renderer.ts` (554-558) lee `UniformsLib.LTC_FLOAT_1/2`, que solo existen tras esa llamada | Mover la inicialización al motor (que la haga él al crear el renderer) y borrar la llamada del juego | Bajo |
| 8 | `game/compile.ts` | `compileGently` (calentamiento propio de three/WebGL) | Se sustituye por `warm()` (Tarea 6) | Borrar en la Tarea 12 | — |

## Límites del motor que pueden afectar al portar
Sin transparencias en mallas ni UI, un material por modelo, UV dentro de [0, 1], luces puntuales sin sombra (máx. 4 focos). Ninguno de los huecos de arriba los necesita; si al comprobar la paridad visual aparece alguno (p. ej. un material transparente), se añade como fila nueva.

## Pendiente de verificar (Tarea 10)
Capturas antes/después con el banco de fidelidad para: `cos-tint`, `concrete`, `poolTile`, `parking-dust`, lightmap, y cada shader de usuario (polvo, cielo, rayos, alfombra, agua, charcos, vents, atmósfera, `waterjet`, remotos).
