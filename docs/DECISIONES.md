# Decisiones que no se deshacen

Formato: decisión / por qué / no tocar sin... Salen del historial reciente de git y del código. La mayoría son de rendimiento (nivel -20 y pasillo de Las Suites, medido en llamadas de dibujo y ms de CPU).

## Rendimiento

**Fusión de mallas por material (`client/src/game/fuse.ts`).** Las piezas de puertas, carteles de salida, cabinas y escaleras se funden en una malla por material. Por qué: las llamadas de dibujo (CPU) eran el cuello de botella, no los triángulos (mallas 1758 a 1480 solo con las puertas). No tocar sin: medir llamadas de dibujo antes y después y comprobar que nada animado entra en `fuse`/`fuseAll` (solo modelos quietos).

**InstancedMesh para decoración (apliques, halos, objetos repetidos).** Una llamada por tipo. Por qué: pasillo 305 a 286 llamadas, vestíbulo 483 a 331. No tocar sin: comprobar el parche del lightmap (ver más abajo) y la visibilidad por distancia.

**Culling por habitación y distancia (`cullRoom`, `PROP_FAR`, `farObjs`, `levelObjs` en `world.ts`).** Lo instanciado a más de `PROP_FAR` (24 m) no se dibuja; el botín de una habitación no se dibuja con la puerta cerrada; los huecos de escalera lejanos (`farObjs`, 36 m) y las puertas de otros niveles de la escalera (`levelObjs`, solo a su altura) tampoco. Por qué: pasillo ~370 a ~305 llamadas. No tocar sin: probar a abrir/cerrar puertas, subir de planta y soltar objetos (`onPut` llama a `cullRoom`).

**Reflector del suelo a 256 px y repintado cada 3 fotogramas; sin reflejo en calidad baja.** Solo pinta paredes, techo y paneles (a 14 m). Por qué: el reflejo duplicaba la escena. No tocar sin: medir ms de CPU en el pasillo y mirar que el suelo no parpadee al moverse rápido.

**Lightmap horneado con parche `onBeforeCompile` (solo `USE_INSTANCING`, no `BatchedMesh`; `lightmap.ts`, `world.ts`).** La luz del mapa va horneada; el parche aplica el lightmap a las mallas instanciadas. Por qué: three 0.160 y `BatchedMesh` no encajan con el parche. No tocar sin: subir three (está fijado en 0.160) o cambiar a `BatchedMesh`.

**Luces dinámicas limitadas: pool de 3 `PointLight` en `vents.ts`** (más las 4 de `game.points`, el hemisferio y la linterna). Por qué: cambiar el número de luces recompila todos los materiales. No tocar sin: aceptar el tirón de compilación; no añadir luces reales a las escenas.

**`renderer.shadowMap.autoUpdate` según la linterna.** Con la linterna apagada su mapa de sombras no se ve y no se repinta. No tocar sin: comprobar que las sombras vuelven bien al encenderla.

**Resolución dinámica (DRS) consciente de la CPU (`game.ts`).** No baja píxeles si el fotograma lo come la CPU (`renderMs` alto): bajar resolución no ayuda y degrada la imagen. No tocar sin: medir en una máquina con la GPU sobrada y la CPU limitada.

## Contenido y juego

**Cinta de precaución desactivada en Las Suites.** El Faceling no la vende y el jugador no la usa allí. No tocar sin: decidir antes para qué serviría en ese nivel (el gadget sigue en otros).

**Interruptores de la luz (cuadros, `gens`) con la tecla mantenida 1,5 s.** Soltar cancela. Por qué: un toque era demasiado fácil de accionar sin querer. No tocar sin: replantear el aviso de la tecla (`hint`) y el equilibrio de las misiones.

**El Faceling herido de un tiro se enfurece y va a por el jugador.** Es la consecuencia de disparar, no un fallo. No tocar sin: revisar la dificultad de Las Suites.

## Arquitectura

**Simulación compartida en `shared/` (determinista, la misma en cliente y servidor).** Mapas y ids salen de semillas, sin `Math.random()` en generadores ni consumo extra del rng en los caminos existentes; el servidor es autoritativo y se envían semillas, no mapas. Por qué: sin esto cliente y servidor se desincronizan. No tocar sin: comprobar que ambos lados derivan lo mismo (ver el checklist de [CONTRIBUTING-LLM.md](CONTRIBUTING-LLM.md)).

## Herramientas

**Biome solo como linter** (`npm run lint`, sin formateador ni organizar importaciones): el formateo masivo generaría un diff gigante. **lefthook** ejecuta `check_staged_files.py`, `biome lint --staged` y `typecheck` antes de cada commit. El panel `?debug` (lil-gui) se carga con `import()` dinámico y solo en desarrollo local.

**Huellas de sincronización (`shared/src/sync.ts`: `fnv1a`, `mazeHash`, `stateHash`).** El cliente manda la huella del mapa que ha generado en `ready(true, hash)` (fase de votación, `warmLevel`) y el servidor, si difiere de la suya (misma semilla, planta y nº de jugadores), escribe `[desync]` con nivel, semilla y sala (solo `console.warn`; parking y Poolrooms no se comprueban). Por qué solo el mapa: las entidades las lleva el servidor (`EntitySim` usa `Math.random`) y llegan por snapshot, así que cliente y servidor no las derivan igual por diseño; `stateHash` (posiciones a 1 cm) sirve para comparar dos snapshots o dos ejecuciones, y en desarrollo `__game.stateHash()` da ambas huellas. Barandilla: `tools/biome/shared-determinismo.grit` (plugin de Biome, aviso, solo en `shared/src`) marca `Math.random()` y `Date.now()`; hoy los usa `sim.ts` (la IA de `EntitySim`, solo en el servidor en sala) y `parking-smiler-ai.ts` (un barajado), no los generadores de mapas. Siguiente paso, si hiciera falta de verdad: hacer `EntitySim` determinista con un rng sembrado y enviar `stateHash` cada N ticks; no se hizo porque cambiaría el comportamiento de las entidades.
