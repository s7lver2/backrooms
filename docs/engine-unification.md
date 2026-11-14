# Motor único (Player común para todos los niveles)

## Problema
Nivel 0 y Las Suites usan `World` + `Player` (el Player hace física, manos, muerte, objetos). Las Poolrooms usan `PoolLevel` (`poolmap.ts`, ~1650 líneas) con **su propia** física, cámara, objetos, muerte y espectador; el `Player` va pegado encima como figurante (`Game.poolHands`, `poolMatch`, `poolFrame`, ~38 `instanceof PoolLevel` en `game.ts`). Cada ajuste del Player hay que portarlo a mano → bugs (velocidad, salto, manos, cuerpo caído, tótem, escaleras).

## Objetivo
Un solo controlador (`Player`) con **todas** las capacidades (andar, correr, agacharse, saltar, nadar, deslizarse/tubos, plantas, escaleras, aire/desmayo, objetos, muerte, espectador, tótem, Uno...). Cada nivel solo describe su mundo y qué capacidades tiene (`levelCaps`).

## Contrato: `Terrain` (lo implementan `World` y `PoolLevel`)
- `floorAt(x, z, y)` → altura del suelo que toca a esa altura (plantas, rampas, peldaños) o `null` (pared).
- `fits(x, z, y, r, mode)` → ¿cabe el cuerpo? (paredes, columnas, tubos, mobiliario, borde de pozos).
- `ceilAt(x, z, y)`.
- `liquidAt(x, z)` → `{ surface, depth }` o `null` (nadar si profundidad > umbral).
- `flowAt(x, z, y)` → movimiento forzado (tobogán, tubo con su curva y velocidad) o `null`.
- `voidAt(x, z)` → vacío mortal (solo si el nivel tiene `caps.fall`).
- `root`, `lightsNear`, `solid` (para entidades y cinta).

## Fases (cada una deja el juego jugable; probar nivel 0, Suites y Poolrooms al acabar)
1. **(HECHA, 14/11/2026: `terrain.ts`; `World` y `PoolLevel` lo implementan; el Player aún no lo usa)** **Contrato y adaptadores.** Definir `Terrain` en `client/src/game/terrain.ts`; `World` lo implementa envolviendo lo que ya tiene (`floorAt`, `solid`, `voidAt`, `pitAt`); `PoolLevel` expone `floorAt/fits/liquidAt/flowAt` con su lógica actual (`fl`, `fits`, `wat`, `ride`). Sin cambiar comportamiento.
2. **(HECHA A MEDIAS, 14/11/2026)** **Física en el Player.** Hecho: `locomotion.ts` (constantes y reglas de andar/correr/saltar/agacharse/diagonal, una sola vez; el Player y `PoolLevel` las importan) y el movimiento de las Poolrooms extraído de `update` a `PoolLevel.move`. Pendiente (se hace junto a la fase 3, porque la cámara y el cuerpo dependen de la misma posición): que el Player llame a `move` del terreno y sea dueño de la posición. Original: Mover a `Player.update` lo que hoy hace `PoolLevel.update`: salto/gravedad (ya unificados en constantes), pasos y escaleras, nado (`liquidAt`), `flowAt` (tobogán/tubo), aire (`o2`, desmayo) tras `caps.swim`. `PoolLevel.update` pasa a solo ondas, luces, agua, cabina, parpadeos.
3. **(HECHA, 14/11/2026, sin probar en juego)** Resumen: el Player es dueño de la mirada y de la cámara también en las Poolrooms y mueve el cuerpo con `terrain.drive` (`PoolLevel.pre → Player.update → PoolLevel.post`); `handY`, `ext`, `deathAt` y el guardado/restauración de la cámara desaparecen; la cámara de `PoolLevel` solo se mueve sola si está muerta (o sin Player, en desarrollo). **Cámara única.** La cámara la mueve el Player (ya lo hace en nivel 0); `PoolLevel.camera` desaparece o se alimenta del Player. Fuera `handY`, `ext`, `slowMul`, `walkSp/runSp/jumpV` (puentes actuales).
4. **(HECHA A MEDIAS, 14/11/2026)** Hecho: pistola de agua única (`waterjet.ts` + `Player.spray`; fuera la copia de `PoolLevel`). Y los pickups: `pickups.ts` (`PickupField`: flotar, alcance, aviso, mano, `claim`, `sync`, soltados con físicas) lo usan `Items` (nivel 0, Suites) y `PoolPickups` (Poolrooms); fuera `soaps`, `put`, `claim`, `onTake` de `PoolLevel`. **Objetos y pistola de agua.** Los pickups de `PoolLevel` (jabones, bebederos, tanque, pistola, latas) pasan a `Items`, parametrizado por los puntos del `Maze` (ya hay `itemSpots`). La pistola de agua es un arma más del Player (`jetting`, depósito).
5. **(HECHA A MEDIAS, 14/11/2026)** Hecho: `sendState` único (también Poolrooms; el Uno Reverse y el admin por fin cuentan como teletransporte en ellas), barra rápida y rueda las lleva el Player en todos los niveles (fuera `poolHot`, `inPool`, `poolState`). Pendiente: `frame` y `poolFrame` siguen siendo dos bucles (el del nivel 0 mezcla cosas propias: Items, TVs, entidades locales, muerte con cinemática); queda sin unificar: el cierre de ronda (ascensor/`ascend`), la muerte y el espectador, que en el nivel 0 llevan cinemática y en las Poolrooms no. (Hecho: el ascenso es un solo `win()` para todos los niveles. Sigue aparte la muerte con cinemática del nivel 0.) Unificarlos pide una abstracción `Level` (una interfaz con `frame`, `onDeath`, `exit`) y conviene hacerlo con las Poolrooms ya probadas. **Bucle único en `Game`.** Un solo `frame` para todos: borrar `poolFrame`, `poolHands`, `poolMatch`, `poolHot`, `poolState`, `poolDied`, `poolRevived`; muerte, espectador, tótem (con/sin «Run for your life» según caps), Uno, entidades y sala funcionan igual.
6. **Limpieza.** Borrar código duplicado; actualizar `docs/ARCHITECTURE.md`, `docs/level-caps.md`, `docs/poolrooms.md`.

## Verificación (a mano, sin tests)
Lista por nivel: velocidad andar/correr/agachado, salto, escaleras (sin atravesar paredes), nadar y salir, tobogán/tubo (entrada, colisión, salida), objetos (coger/soltar/usar), pistola, muerte (cuerpo se queda donde cae), espectador libre, tótem propio y ajeno, Uno, entidad, ascensor, tienda.

## Riesgos
- Poolrooms tiene física propia fina (agua, pozos sin fondo, plantas): portar sin cambiar el tacto. Se compara fase a fase contra el comportamiento actual.
- El navegador integrado no corre frames con el panel oculto: la verificación visual la hace el usuario o se prueba con el panel visible.
- `server/` ya es común (`Match`, `levelCaps`); solo se toca si cambia `caps` o el estado enviado.
