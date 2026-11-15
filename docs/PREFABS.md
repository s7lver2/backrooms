# PREFABS

Piezas que se escriben **una sola vez** y valen para todos los niveles (nivel 0, Las Suites, Poolrooms, Habitable Zone). Un nivel nuevo no reimplementa nada de esto: monta su mundo, dice qué capacidades tiene y enchufa los prefabs. Regla general: si te ves copiando código de otro nivel, falta un prefab o no lo estás usando.

| Prefab | Archivo | Para qué |
|---|---|---|
| Capacidades del nivel (`LevelCaps`) | `shared/src/caps.ts` | Qué componentes del jugador están activos en cada nivel |
| `Terrain` | `client/src/game/` (contrato; ver `engine-unification.md`) | Lo que un mundo le debe dar al `Player` |
| `Player` | `player.ts` | El cuerpo propio: física, manos, objetos, muerte |
| `Remote` | `remote.ts` | El cuerpo de cada compañero |
| `Rig` | `rig.ts` | Personaje de Mixamo con sus clips (base de `Player`, `Remote` y entidades) |
| `Cosmetics` | `cosmetics.ts` (+ `pieces.json`) | Color, sombrero y mochila de un avatar |
| `entityBody` / `Entity` | `entity.ts` | Cuerpo y comportamiento visual de bacteria, partygoer y faceling |
| `ElevatorCab` | `elevator.ts` | La cabina de salida de todos los niveles |
| `PickupField` / `PickupHost` | `pickups.ts` | Todo lo recogible del suelo |
| `Epilogue` / `Stage` / `Actor` | `epilogue.ts` | El final de una ronda ganada |
| Emotes | `shared/src/index.ts` (`EMOTE_DEFS`), `emotes.ts` | Bailes equipables y pose de victoria |

## Qué prefab usa cada nivel (revisado 15/11/2026, leyendo el código)

| Prefab | Nivel 0 / Suites | Poolrooms | Habitable Zone (parking) |
|---|---|---|---|
| `LevelCaps` | sí | sí | sí (`parking`) |
| `Player` + `Terrain` | sí (`World`) | sí (`PoolLevel`) | sí (`level.terrain`) |
| `Remote` | sí | sí | sí |
| `Rig` / `Cosmetics` | sí | sí | sí (skinwalkers) |
| `ElevatorCab` | sí | sí | sí |
| `Epilogue` | sí | sí | sí |
| `entityBody` / `Entity` | sí | sí (entidades del servidor) | **no** (`caps.ents = false`): skinwalkers y smilers propios; comparten `followPose`, `Rig` y `Cosmetics` (ver «Por qué...») |
| `PickupField` | sí (`Items`) | sí (`PoolPickups`) | **no**: taquillas, objetos y cintas son código propio de `parking.ts` (`storageItems`, `takeItem`, `parkingInteract`); no hay objetos soltados ni `syncDrops` |
| `Gadgets` | sí | sí | **no** |

Por qué el parking no los usa hoy (revisado a fondo el 15/11/2026):
- `PickupField` está pensado para celdas planas (`Cell`, `CELL`, suelo a una altura) y para el protocolo `claim` / `lockerTake`. El parking tiene varias plantas (`y`), taquillas con puertas con colisión propia (`parking.ts`, `hinges`) y su protocolo `parkingInteract`. Para unirlos hay que dar altura/planta a `PickupHost` y a los soltados (`Drop` solo lleva `x, z`), y cambiar el servidor.
- `Gadgets` (cinta, radar, tótem): el servidor **prohíbe** esos objetos en el parking a propósito (`server/src/index.ts`, lista `['gun','ammo','watergun','tank','totem','radar','caution']`) y `parkingInventory` los quita en el cliente. Además las cintas son planas (`x, z`, sin planta). Meterlos es una decisión de diseño, no solo de código.
- `Entity` / `entityBody`: `Entity` ya no depende de `World` ni de `EntitySim` (acepta un `EntityHost` y un `Brain`, ver sección 7), pero los enemigos del parking **no se han migrado** a él, por dos motivos concretos:
  - **Skinwalker:** lleva dos `Rig` a la vez (humano y bestia) que se funden por opacidad de materiales, `Cosmetics` del jugador y partículas de transformación; `Entity` es un cuerpo con un solo `Rig` y los clips salen de `ENTITIES[kind]` (`shared/sim.ts`). Además su IA (`ParkingSkinAI`) actualiza **todos** los agentes de golpe y el cliente solo lee su pose (también en red, `syncNetwork`); no es una cabeza por entidad. Migrarlo exigiría un `Kind` nuevo en `shared/sim.ts` con clips humano/bestia y un cuerpo de dos rigs en `entityBody`, y no se puede probar sin navegador. Se comparte solo lo seguro: `followPose` (suavizado de pose) y `Rig`/`Cosmetics`.
  - **Smiler:** no es un cuerpo: es un velo, una cara aditiva y humo instanciado orientados a la cámara. No hay `Rig` que reutilizar.

---

## 1. Capacidades del nivel (`LevelCaps`)
El jugador es un prefab con componentes (inventario, nadar, caída, cordura...). **El servidor** decide cuáles valen en cada nivel.

**Uso**
- Nivel nuevo: una entrada en `LEVEL_CAPS` (`shared/src/caps.ts`) y otra en `LEVELS` (`missions.ts`).
- Capacidad nueva: un campo en `LevelCaps` y su valor en **cada** nivel.
- En código se pregunta a `caps` (`levelCaps(id)`, `Game.caps`); **nunca** `levelId === '...'`.
- Un nivel que no usa un componente solo lo desactiva; nunca quita lo que el jugador lleva.

Detalle en `level-caps.md`.

## 2. `Terrain` (contrato del mundo)
Lo que un mundo (`World`, `PoolLevel`, el parking) implementa para que el mismo `Player` lo recorra: `floorAt`, `fits`, `ceilAt`, `liquidAt`, `flowAt`, `voidAt`, `root`, `lightsNear`, `solid`. Si el mundo cumple el contrato, anda, nada, cae y se esconde igual que en los demás. Ver `engine-unification.md`.

## 3. `Player`
`new Player(world, assets, camera, flash, reduced)`. Añade su cuerpo a `world.root`. Lleva la física (constantes en `locomotion.ts`: `WALK`, `RUN`, `EYE`...), cámara, manos y agarres con IK, objetos, muerte, espectador y emotes (`showEmote`).

**Uso**
- Un único `Player` por partida; el nivel no mueve el cuerpo por su cuenta, le da el `Terrain`.
- `showEmote(clip, pies, yaw, dt, primeraPersona?)` pone el cuerpo a bailar con la cámara fuera (o, con `primeraPersona`, devuelve la posición de la cabeza para colocar la cámara).

## 4. `Remote` (compañeros)
`new Remote(assets)` → `reset(id, nombre)` → `setLook(look)`; se alimenta con `set(PlayerState)` y se anima con `update(dt)`. Interpola con un buffer de red; un estado **sin `t`** se toma como posición fija (se usa en el final de ronda).

**Uso**
- Se reutilizan (máx. 3 clones, `Game.spare`); se cuelgan de la escena del nivel actual (`syncRemotes(..., parent)`).
- Lo que se ve de cada uno (objeto en mano, linterna, bombona, baile) sale de `PlayerState`; no se pinta nada a mano.
- Para mostrar **tu propio cuerpo** fuera del `Player` (parking, Poolrooms en el final): un `Remote` extra con tu `look`.

## 5. `Rig`
`new Rig(gltf)`: clon con piel del modelo, `play(clip, fade, once)`, `bone('Head')`, `update(dt)`. Es la base de todo personaje animado. Con `useAnimator()` el paquete de animaciones (`anim/`) lleva el cuerpo.

**Uso**: cualquier personaje nuevo se crea con `Rig`, no con un `AnimationMixer` propio.

## 6. `Cosmetics`
Accesorios de un avatar: tinte de color + sombrero (`head`) + mochila (`back`). Se colocan cada fotograma en el mundo a partir del hueso.

**Añadir un cosmético (checklist)**
1. Convertir el modelo: `python tools/pack_glb.py <carpeta-del-gltf> client/public/models/cosmetics/<id>.glb --max 512`.
2. Entrada en `COSMETICS` (`shared/src/progress.ts`): `{ slot, id, name, need }` (`need` = clave de logro o `null`).
3. Entrada en `client/src/game/pieces.json` (`slot`, `size`, `scale`, `up`, `fwd`, `side`, `rx/ry/rz`). Se afina en el estudio `/?anim` (pestaña IK).
4. Copiar la licencia al final de `models/cosmetics/LICENSES.txt`.

El armario, el perfil y los avatares remotos lo recogen solos.

## 7. `entityBody` / `Entity`
`entityBody(kind, assets)` → `{ rig, balloon? }`: el modelo a su altura, color de la bacteria y globo del partygoer. `Entity` añade IA visual (en solitario) o interpolación de red (en sala).

**Uso**
- Si solo necesitas **ver** una entidad (menú, final, minijuego): `entityBody`, sin `Entity` ni `World`.
- Clips por entidad: `CLIPS[kind]` (`walk`, `dances`...), salen de `ENTITIES` (`shared/sim.ts`).
- `Entity(kind, host, assets, celda, velocidad, hp, remote?, brain?)`: `host` es un `EntityHost` (`root` donde colgar el cuerpo; `maze` y `solid` solo si va a llevar la cabeza de serie, `EntitySim`). `World` lo cumple.
- Una IA nueva (con plantas, por lotes...) se adapta a `Brain` (`x`, `z`, `facing`, `state`, `moving`, `hp`, `update`, `hit`, `dance`; `EntitySim` ya lo cumple) y se pasa como `brain`; el cuerpo, los clips, el globo y el baile son los mismos. Los clips siguen saliendo de `ENTITIES[kind]`: un monstruo nuevo necesita su `Kind` en `shared/sim.ts`.
- `followPose(root, pose, dt, smooth)`: pone un cuerpo en una pose que llega a saltos (red o IA por lotes), con un pulido corto si `smooth`. Lo usan los skinwalkers del parking.

## 8. `ElevatorCab`
La cabina de salida: geometría y texturas procedurales (sin modelos).

```ts
const cab = new ElevatorCab(ancho, fondo, alto, planta, cerrada, anchoDePuerta);
cab.group  // colocar y girar: origen en el umbral, +z hacia fuera, la cabina hacia -z
cab.open() // se puede entrar
cab.board() // el jugador está dentro: cierra y arranca
cab.update(dt); cab.shake // temblor de cámara durante el viaje
cab.dispose()
```
Los niveles solo la colocan; el viaje, el temblor y el panel son del prefab.

## 9. `PickupField` / `PickupHost`
Todo lo recogible: objeto flotante con brillo de rareza, aviso, mano que baja, petición al servidor (`claim`), `sync` de lo cogido y `syncDrops` de lo soltado (con físicas).

**Uso**: el nivel implementa `PickupHost` (`root`, `solid`, `cellAt`, opcional `span` si el mundo se repite) y construye su `PickupField` (o una subclase: `Items` en el laberinto, `PoolPickups` en las Poolrooms). No se escriben recogidas propias.

## 10. `Epilogue` (final de ronda)
Al ganar, el servidor manda `RoundResult.victory` (la pose de cada jugador). El prefab monta: fila de jugadores con su pose, entidades bailando detrás y cámara que se mece mirando a la fila. El cliente muestra después **CONTINUE · ANOTHER ROUND** o **SAVE AND EXIT**.

```ts
interface Stage { scene; camera; solid(x, z): boolean }   // el escenario del nivel
interface Actor { place(at, yaw); tick(dt, at, yaw) }      // un jugador
new Epilogue(stage, assets, pies, yaw, actores, tiposDeEntidad)
ep.frame(dt)    // cada fotograma; ep.dispose() al salir
```

**Añadir el final a un nivel nuevo**
1. En `Game.epilogue()` añade la rama con su `Stage` (escena donde se pinta, cámara, `solid`).
2. Si su cuerpo no cuelga del mundo, usa el clon `Remote` propio (como parking y Poolrooms).
3. Esconde lo propio del nivel que no deba verse (enemigos, entidades reales).
4. En `epiFrame()`, lo que el nivel necesite para pintarse sin su bucle normal (agua, luz, `round.render`...). La cámara la mueve el prefab.
5. El final **no** ocurre donde se acabó: `findSpot(arena)` busca al azar un sitio espacioso (círculo de ~8 m libre). El nivel solo da su `Arena` (límites + `ok(x, z)`: se puede estar de pie). Si no hay ninguno, usa la última posición viva (`liveAt`/`liveYaw`, que se guardan en `frame()`; si el nivel usa otra cámara, se añade ahí).

Si `epilogue()` devuelve `false` (nivel sin soporte, derrota), se usa la pantalla de fin de siempre.

## 11. Emotes
- Definición: `EMOTE_DEFS` (`shared`): nombre, clip, duración, logro que lo abre (`emoteOpen`).
- Equipados: `emoteGate` (`emotes.ts`): hasta `EMOTE_SLOTS` (5), elegidos en el armario (`EmoteLoadout.tsx`), guardados en el navegador. Son los de la rueda B y las teclas 1–5.
- Pose de victoria: una de las equipadas (★); se manda en `PlayerState.victory` y vuelve en `RoundResult.victory`.

**Emote nuevo**: entrada en `EMOTE_DEFS` (y su clip en el paquete de animaciones); el armario, la rueda y las teclas lo ofrecen solos.

---

## Antes de crear algo nuevo en un nivel
1. ¿Ya existe un prefab? Úsalo (tabla de arriba).
2. ¿Lo necesitarán dos niveles? Hazlo prefab y anótalo aquí.
3. ¿Depende de un nivel concreto? Que sea una capacidad (`LevelCaps`) o un campo del `Stage`/`Host`, no un `if (nivel === ...)`.
