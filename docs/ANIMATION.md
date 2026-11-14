# Sistema de animación

Código en `client/src/game/anim/`, herramienta en `client/src/dev/anim/` (abrir `/?anim` con `npm run dev`).

## Anim Studio (`/?anim`)
Una pantalla: biblioteca de clips con miniaturas (izquierda; arrastrables), el `Player` real en tercera persona (centro; W/S andar, A/D girar, Shift correr, C agachar, Espacio saltar), panel inferior según el modo y ajustes a la derecha. Modos: **CLIPS** (etiquetar cada clip), **MOVEMENT** (mapa de estados, tira de blend con pines arrastrables, slots, transiciones con condiciones), **DANCES** (línea de tiempo: arrastrar clips, reordenar, recortar el final, solapar con el anterior, repetir, velocidad), **VARIANTS** (slots por variante), **IK** (banco de pruebas). Ctrl+Z/Ctrl+Y deshacen, Ctrl+S guarda todo. Sobre el visor: ángulos de cámara predefinidos (teclas 1–8: frente, 3/4, lado, espalda, arriba, manos, pies, primera persona), huesos y rejilla, y el **CONTROLLER** (palanca virtual, velocidad objetivo, caminar solo recto o en círculo, cinta andadora, cámara lenta 0,05–2×, pausa y avance de un fotograma, agacharse, saltar, qué lleva en las manos). Las zonas se redimensionan arrastrando las barras finas (se recuerda); `?` muestra los atajos.

## Flujo
1. **Paquete** (automático: el plugin `animPack` de `client/vite.config.ts` lo lanza al compilar y, en desarrollo, vigila las carpetas de FBX: soltar un FBX nuevo, cambiarlo o borrarlo repaqueta solo —incremental, caché en `node_modules/.cache/anim-pack`— y Anim Studio recoge el clip sin recargar, con su miniatura y una categoría puesta a ojo por el nombre; `node tools/anim_pack.mjs` lo hace a mano): lee los FBX de Mixamo (`assets-src/animations/player/` si existe, si no `client/public/animations/player/`) y escribe `client/public/animations/player.pack.json` + `.bin` (clips a 30 fps, cuaterniones int16, ~3 MB). Repetir al añadir o cambiar FBX. Los FBX no se sirven ni se commitean (`.gitignore`).
2. **Runtime** (`core.ts`): `loadPack()` baja el paquete; `Pose` = un cuaternión por hueso; nodos: `clip`, `blend1d`, `blend2d`, `machine` (estados + transiciones con condiciones y cruce), `layer` (capa con máscara de huesos y peso por parámetro), `dance` (secuencia).
3. **Animator** (`animator.ts`): evalúa el árbol (`tree.json`) con sus parámetros `p` (`speed`, `crouch`, `air`, `vy`, `hold`), mezcla encima lo que se reproduce suelto (`playOver`: bailes, clips), pone el resultado en los huesos del modelo (compensa el giro del Armature del GLB en la cadera) y pasa la pila de IK.
4. **Rig** (`rig.ts`): `rig.useAnimator()` lo activa si el paquete ya está bajado. Con Animator, `rig.play(clip)` solo vale para clips de un golpe del modelo (coger, morir); andar/correr/quieto son parámetros. Sin paquete todo sigue como antes (clips del GLB).

## Datos (JSON editables con la herramienta)
| Archivo | Qué es |
|---|---|
| `anim/tree.json` | parámetros, **slots** (nombres lógicos `$walk` → clip) y el árbol |
| `anim/dances.json` | bailes: segmentos `{clip, in, out, rate, loops, fade}`; cada uno entra con un solape (`fade`) sobre el anterior |
| `anim/variants.json` | variantes tipo cosmético: qué clip sustituye a cada slot (p. ej. `walk` → «Strut Walking») |
| `anim/manifest.json` | categoría de cada clip: `tree`, `dance`, `part` (trozo de baile), `variant`, `action` |

Hay variantes y bailes de ejemplo; el árbol usa `fit` (los clips de andar/correr se aceleran a la velocidad real; el umbral `at` de cada clip es la velocidad a la que se ve bien).

## IK (`ikstack.ts`, usa `solveArm` de `ik.ts`)
Va después de la animación y parte siempre de la pose animada de ese fotograma, con pesos que suben y bajan suave:
- `ik.goals`: brazo o pierna a un punto y orientación del mundo (`target()` devuelve null → el peso baja a 0).
- `ik.ground(x, z)`: pies al suelo (cada pie en contacto se apoya; la cadera baja con el pie más bajo).
- `ik.aim`: el torso se reparte el giro hacia una dirección.
Los agarres de objetos del `Player` (`grips.json`) pasan por esta pila: `Player` fija cada fotograma el objetivo de cada muñeca (`gripT`) y llama a `ik.run` (el Animator lo difiere con `deferIk`). El peso sube y baja suave y, al soltar, el brazo vuelve a la animación desde el último objetivo; los dedos y huesos que el paquete no anima vuelven a reposo cada fotograma. Se editan en Anim Studio → IK → grips (los accesorios siguen en `/?anim (IK tab)`). Ahí están todos los objetos del juego: linterna, camcorder, rifle, pistola de agua, cinta, radar, tótem, lata de Almond Water, jabón, cinta VHS, caja de balas (`Player.prop`: objeto suelto en la mano, sin función de juego todavía) y la bombona de buceo, que va a la espalda y se coloca aparte (`worn.json`, que lee `Remote`). Al elegir un objeto la cámara va a él (cámara «Item», tecla 9).

## Red
`PlayerState.dance` (id del baile) y `PlayerState.variant` (id de la variante); el servidor solo valida que sean `\w{1,24}`. `Remote` los aplica; la velocidad del árbol sale del movimiento real.

## Pendiente / ideas
- Enganchar los bailes de victoria a un momento del juego (hoy: `Player.dance(id)` y `Remote` ya los reproducen) y elegir la variante desde la cuenta/cosméticos.
- Clips de strafe (blend2d ya existe) y de apuntar para el rifle.
- Pies al suelo y `aim` están listos pero no se activan en `Player`.
