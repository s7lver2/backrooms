# Las Suites (nivel 20): documento de diseño

Borrador vivo. Se rellena con las decisiones que se van tomando; lo no decidido está en «Preguntas abiertas».
Referencia: Nivel -20 «Las Suites» de la wiki de los Backrooms (hotel de 100 plantas, 100 suites por planta, limpio y agradable, Personal de Facelings y vagabundos, EEH, fuente de agua de almendras en el centro).

## 1. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Estructura | **Ronda vertical:** la ronda sube pisos del hotel; cada planta es un mapa propio (semilla por planta). |
| Tono | **El EEH falla:** el hotel es amable y seguro hasta que el Evaporador de Entidades Hostiles se estropea y las entidades entran. Calma, luego caos. |
| Alcance v1 | Pasillos y suites + recepción y vestíbulo (fuente de agua de almendras). Spa, restaurante, hospital y cocina quedan para después. |
| Modelos | Los vuelca el usuario como .glb; yo los preparo (`tools/pack_glb.py`, gltf-transform simplify/meshopt). |
| Identificador y nombre | `suites`; en la pizarra **LEVEL -20 · THE SUITES**. |
| Desbloqueo | Un nodo nuevo del árbol de mejoras (como `pool` para las Poolrooms). |
| Plantas por ronda | **5.** Se sube con una **mezcla de ascensor (rápido, hace ruido) y escalera (silenciosa, larga)**. |
| Peculiaridad | **Mapa que se cierra sobre sí mismo:** si sigues caminando hacia un lado acabas, sin que se note, por el otro. Ver sección 4. |
| EEH | **Fallo aleatorio por ronda:** el momento lo marca la semilla; a veces no llega a fallar. |
| Bucle | **Solo el largo del pasillo** (un eje) y **perfecto**: sin indicio ninguno; ver sección 4. |
| Entidades tras el fallo | **Partygoers** (ya existen) y **Facelings hostiles** (nuevos). |
| Música | **El lago de los cisnes** con una **grabación libre de dominio público** (la obra lo es; hay que comprobar la licencia de la grabación concreta). |
| Pago | La tienda del Faceling cobra del **saldo común del equipo**, el mismo de la tienda de la sala de espera. |
| Tienda tras el fallo | **Se cierra para siempre** cuando el EEH falla y el Faceling se vuelve hostil. |
| Megafonía | Al empezar, **da la bienvenida**. Cuando el EEH falla, **empieza a sonar El lago de los cisnes**, con las luces parpadeando y bajando a rojo suave. |
| Misiones | Encender los cuadros de generadores, subir a la planta 5, recoger objetos del hotel, encargo de recepción y sobrevivir al fallo del EEH. **Se votan en la pizarra como las demás.** |
| Generadores | Son **cuadros de generadores** (cuadros eléctricos). **Al encenderlos vuelve el ascensor.** **Cada planta empieza con el ascensor sin corriente**, así que hay que encender sus cuadros en cada una. |
| Fallo del ascensor | Al usarlo hay un **10 % de probabilidad de que falle y caiga hasta la última planta**. La caída es **rápida y brusca**, y los personajes **flotan** dentro de la cabina durante ella. |
| Ascensor | Se reutiliza la **cabina modular** (`client/src/game/elevator.ts`, la salida de todos los niveles), que además de ser la salida del nivel **se comporta como un ascensor normal**: se llama, abre, lleva a otra planta. Al irse (misión cumplida) **se desbloquea una planta especial** que es la salida. |
| Personal (Facelings) | **Son vendedores y se vuelven hostiles cuando el EEH falla.** Al interactuar con uno, **se aparta a un lado y se abre la tienda como interfaz (UI)**, como la del terminal de la sala de espera: no hay tienda 3D. Venden **artículos con rarezas ya definidas**; **su inventario es aleatorio**. |
| Uniforme del Faceling | **Chaqueta roja**, camisa blanca y pantalón negro. Se repinta la textura del modelo PSX (las islas de torso y brazos se localizan por los pesos de los huesos). |
| Animación del Faceling | Los clips **ya vienen de Mixamo** (paquete de 45 en `client/src/game/anim/`). El Faceling tiene otro esqueleto (17 huesos, sin nombres de Mixamo), así que se **retargetean** en código desde T-pose a T-pose y se mejoran con capas (ver sección 7). |

## 2. Qué da el hotel de distinto

- **Luz cálida, alfombra y papel pintado:** es lo contrario del Nivel 0 (húmedo y zumbante). El contraste es la baza: se nota que algo va mal por pequeños detalles, no por la suciedad.
- **Aroma y silencio:** música ambiental baja, hilo musical, ascensor con campanilla. Los sonidos de entidad destacan más.
- **Puertas de suite numeradas:** muchas puertas, la mayoría cerradas; unas pocas se abren y son escondites o botín.
- **Personal:** Facelings con uniforme que venden cosas desde una tienda tras ellos; tras el fallo del EEH, se vuelven hostiles.

## 3. Estructura de una ronda (propuesta, sin fijar)

1. Se entra por el vestíbulo (planta 1): recepción, ascensores, fuente de agua de almendras en el centro. Es la zona segura del principio.
2. Se sube de planta en planta, 5 en total. Cada planta tiene dos salidas hacia arriba: el **ascensor** (rápido, pero su ruido lo oyen las entidades) y la **escalera de servicio** (silenciosa, pero hay que cruzar más mapa).
3. El **EEH falla en un momento aleatorio** de la ronda (o no llega a fallar). Hasta entonces el Personal vende y no hay amenaza; al fallar, entran entidades y los Facelings se vuelven hostiles.
4. Se termina al llegar a la planta 5 (o al cumplir la misión), como en los otros niveles.

Encaja con el motor: cada planta es un `Maze` (rejilla `CELL = 1.5 m`, `HEIGHT = 2.7 m`) generado por semilla en `shared/`. Lo nuevo es encadenar plantas (ver preguntas técnicas).

## 4. El mapa que se cierra (borrador técnico)

La idea: el mapa de cada planta es **periódico**. Al llegar a un borde se aparece en el borde opuesto sin corte visible.

Cómo se logra sin que se note (pendiente de elegir):
- **Teletransporte exacto.** El mapa se genera con sus dos bordes idénticos (la columna 0 y la última se corresponden). Al cruzar la línea media del pasillo, el jugador salta exactamente el periodo; como lo que ve a ambos lados es igual, no hay salto visible. Las luces horneadas y las sombras tienen que ser también periódicas.
- **Copias en los bordes.** Además, el mundo se dibuja repetido unos metros pasado cada borde (instancing de la franja), para que al acercarse se vea continuar el pasillo.
- **Servidor y entidades.** La rejilla y el BFS pasan a ser toroidales (coordenadas módulo ancho y alto). Distancias, visión (`seesXZ`), disparos y la persecución usan la distancia más corta con vuelta. Los jugadores remotos y las entidades que cruzan el borde se ven en ambos lados.
- **Coste:** toca `shared/` (maze, sim, solidAt, bfs) y el render. Conviene acotarlo a un eje (el largo del pasillo) en la primera versión.

Efecto de juego: el hotel parece infinito (como en la wiki, 7000 pies de largo) con un mapa pequeño, y da un tono inquietante: es imposible «llegar al final».

## 5. Modelos necesarios

Prioridad A (sin esto no hay nivel). Medidas orientativas; el escalado final lo hace `fit()`.

| Pieza | Para qué | Tamaño |
|---|---|---|
| Puerta de suite (con número) | Pasillos. Variantes: cerrada, entreabierta | 0,9 × 2,1 m |
| Alfombra / suelo de pasillo (textura) | Suelo | tileable 1 m |
| Papel pintado **rojo** (damasco dorado) | Paredes. **Hecho**: `client/public/textures/suites/wallpaper_red.jpg` (1024², repintado del verde de «vintage wallpaper texture», CC-BY). Zócalo de madera por código | tileable |
| Aplique de pared / lámpara de techo cálida | Luz horneada | 0,3 m |
| Cama de hotel | Suites | 2 × 1,6 m |
| Sofá / sillón | Suites y vestíbulo | 1,8 m |
| Mesilla + lámpara | Suites | 0,5 m |
| Mostrador de recepción | Vestíbulo | 3 m |
| (Ascensor: no hace falta modelo; se reutiliza la cabina modular `ElevatorCab`, solo la puerta exterior de planta) | Vestíbulo y plantas | 1,4 × 2,2 m |
| Fuente de agua de almendras | Centro del vestíbulo | 3-4 m de diámetro |
| Cuadro de generador (cuadro eléctrico con palancas) | Misión de generadores | 0,8 × 1,2 m |
| Faceling con uniforme (rig humanoide, animación andar/correr/atacar) | Personal amable y hostil | 1,75 m |
| Panel del EEH (pared) y altavoz de techo | Aviso del fallo | 0,5 m |
| Carro de servicio | Pasillos, ambiente | 1 m |
| Planta decorativa / jarrón | Pasillos | 0,6 m |

Estado de los modelos recibidos (revisión del 13/11/2026, todos en `client/public` como .zip, sin procesar):

| Modelo | Uso | Triángulos | Notas |
|---|---|---|---|
| backrooms_faceling_ps1psx_style | Faceling | 656 | **HECHO:** `client/public/models/suites/faceling.glb` (375 KB). Chaqueta roja de doble botonadura dorada, camisa blanca con corbata negra, puños, pantalón y zapatos negros, con 8 animaciones de Mixamo horneadas: `idle`, `walk`, `run`, `strut`, `point`, `angry`, `attack`, `death`. Material aún sin luz (`KHR_materials_unlit`): al cargarlo hay que pasarlo a un material con luz. CC-BY (atribución en `LICENSES.txt`). |
| crimson_blazer_portrait | (descartado) | 205 000 | Escaneo estático de una persona; sin rig. Solo sirve de referencia de color. |
| victorian_bed | Cama | 36 000 | Decimar a ~10 000, bajar texturas (32 MB). |
| chesterfield-sofa | Sofá | 146 000 | Decimar a ~15 000, bajar texturas (18 MB). |
| secretary_desk | Recepción / escritorio | 4 400 | Valido; hace de mostrador por ahora. |
| door_wooden_old, hoppers_hoteldoors_metal | Puertas de suite y de planta | 10 600 / 4 700 | Separar las puertas de la escena de Hopper. |
| electrical_panel | Cuadro de generador | 210 000 | Decimar a ~20 000 y **quitar la transmisión** (vidrio). |
| control_panel | Panel del EEH | 55 000 | Decimar. |
| loudspeakers_horn_speaker | Megafonía | 16 500 | Altavoz de bocina vintage; bajar texturas (13 MB). |
| stylish_ceiling_lamp | Lámpara | 17 000 | Quitar la transmisión; trae una animación. |
| cleaning_cart, gold_hotel_luggage_trolley, luggage | Carros y equipaje | 22 600 / 4 200 / 3 600 | Bajar texturas (21 / 41 / 14 MB). |
| monstera_deliciosa | Planta | 9 300 | Bajar texturas (83 MB). |
| red_carpet | Alfombra | 2 | Es un plano: usar su textura (43 MB, reducir). |
| trash_can | Papelera | 1 600 | Válido. |
| ~~fountain~~ | (descartada) | 23 700 | CC-BY-NC-ND: no se puede modificar. Sustituida por la siguiente. |
| fountain_water_simulation | Fuente | 165 800 | CC-BY. Decimar a ~25 000, quitar transmisión y clearcoat; trae una animación del agua. Escala enorme (unos 20 m de ancho en unidades de la escena): `fit()`. |
| art_deco_mirror | Espejo de pasillo | 784 | Válido. CC-BY. |
| worn_sci-fi_retro_travel_poster | Cartel de pasillo | 360 | Bajar texturas (16 MB). CC-BY. Su estilo sci-fi puede chocar con el hotel: decidir si se usa. |

Faltan: mesilla de noche, mostrador de recepción propio (de momento el escritorio) y altavoz de techo (de momento el de bocina).

Prioridad B (después): lámpara de araña del vestíbulo, cuadros, extintor/señal de salida, bandeja de comida, equipaje, baño de suite (lavabo, bañera), uniforme de Faceling, panel del EEH.

Prioridad C (zonas futuras): spa, piscina, restaurante, cocina, hospital.

Formato: .glb, materiales PBR simples (sin KHR_materials_pbrSpecularGlossiness, que Three r160 avisa), menos de ~20 000 triángulos por pieza pequeña y ~50 000 por las grandes (fuente, mostrador). Las licencias van en `client/public/models/<carpeta>/LICENSES.txt`.

## 6. Preguntas abiertas

- Cuántos cuadros por planta y dónde van; si hay que defenderlos.
- La caída del ascensor: ¿qué daño o pérdida causa (vida, dinero, ningún daño pero te deja en la última planta)? ¿Se puede evitar o avisar?
- Qué grabación de El lago de los cisnes y de qué fuente.
- Texto de la bienvenida de la megafonía.
- Color del uniforme del Faceling (propuesta: chaqueta negra, camisa blanca y detalles rojos a juego con el papel pintado).
- Cómo se ven los Facelings al volverse hostiles.
- Cómo se llama y se ve la planta especial de salida.
- Cómo conviven ascensor y escalera en el diseño (ruido, tiempo de espera, coste de uso).
- Ajuste de la escala de pasillo (más ancho que `CELL = 1.5 m`).
- Cuántas misiones salen por ronda y cuáles dependen de la planta.

## 7. Animación del Faceling (borrador)

El modelo PSX no trae clips. Se reutiliza el paquete de Mixamo del proyecto:
- **Retarget** de cada clip al esqueleto del Faceling por mapa de huesos (rootJoint → Hips, spine1/spine2 → Spine1/Spine2, shoulder → Arm, foearm → ForeArm, hand, thigh → UpLeg, calf → Leg, foot): rotación en el espacio del mundo desde la T-pose de origen a la de destino. Los huesos que el Faceling no tiene (dedos, clavículas, Spine) se ignoran.
- **Clips previstos:** Idle (o Happy Idle) en la tienda y en el pasillo; Walking (a velocidad real, con el `fit` del árbol) para patrullar; Pointing / Talking On Phone como gesto al atender; Running y Slow Run para el Faceling hostil; Brutal Assassination u otro ataque corto para golpear. El paso al lado para abrir la tienda se hace con un desplazamiento sobre el clip de andar.
- **Hecho:** retarget y horneado con `tools/faceling/` (`suit.py` repinta, `bake.py` hornea, `retarget.py` es la librería; luego `tools/pack_glb.py`). Comprobado en navegador: las 8 poses se ven bien en el modelo. Pendiente: que el motor lo cargue como entidad/NPC (necesita el nivel) y las mejoras de abajo.
- **Mejoras en código** (se juzgan jugando): apoyo de pies con `ik.ground`; mirar al jugador con `ik.aim` al atender; respiración leve en reposo; opción de **animación escalonada a ~15 fps** para el aire PS1; sacudida nerviosa al volverse hostil.
- **Clips nuevos:** Mixamo exige una cuenta de Adobe; se descargan a mano y se sueltan como FBX en las carpetas que vigila `animPack` (se empaquetan solos).

## 8. Estado de la base (13/11/2026)

- **Hecho:** `shared/src/suites.ts` (`suitesMaze`: pasillo de 2 celdas con 7 suites por copia de 20 celdas, 3 copias, ascensor en la copia del medio y de adorno en las otras), cap `hotel` en `LEVEL_CAPS`, `LEVELS.suites` (LEVEL -20, solo por admin: está en `DEV_LEVELS`), misiones `suitesMissions` (sobrevivir + objetos), servidor (`Match`) y cliente (`World` con papel rojo, `wrapX` en el bucle de `game.ts`). Prueba local: `/?suites`.
- **Prefabs reutilizados:** puerta, sillón, escritorio con CRT/lámpara, archivador, estante, silla, rejilla, enchufe, `ElevatorCab`, fluorescentes, objetos del mapa (`itemSpots`) y la misma lógica de misiones y tienda.
- **Bucle:** `L = 20` celdas (30 m) > niebla (19 m): al pasar de la copia del medio se salta `L` y no se ve. Los objetos y el ascensor de verdad son únicos (copia del medio).
- **Falta:** nodo del árbol de mejoras, plantas 2-5 y el ascensor con apagón/caída 10 %, cuadros de generadores, Facelings en el motor + tienda UI, fallo del EEH, megafonía y luz cálida (hoy fluorescentes).
- **Plantas (13/11/2026):** `Room.floor` (1-5). Ganar una ronda en Las Suites sube una planta y la ronda siguiente es otra vez Las Suites (semilla nueva, `suitesMaze(seed, floor)`: las placas de las puertas llevan el número de planta, 1xx…5xx); perder o pasar de la 5 vuelve a la 1. Al subir, el ascensor falla con `SUITE_FALL` = 10 % y cae a la 1 (se cobra igual y se conserva lo que se lleva). La pantalla de fin dice la planta que viene. Falta: el apagón visible del ascensor antes de la caída y que cada planta sea más dura.

- **Hotel, 14/11/2026:** la escalera de servicio (con la misión hecha) abre un selector de planta: se puede ir a **cualquiera** (1-5), no solo a la siguiente (`ascend(inv, floor)`; el servidor guarda `toFloor` y no hay caída del ascensor). Tres Facelings pasean por el pasillo (cosmético, `World.addWalkers`, del reloj de la partida). Una puerta no se cierra encima de alguien (`World.occupants`). Encender un generador se hace tecleando (`Player.typing`).
- **Misiones del hotel, 14/11/2026:** la pizarra ofrece 3 por planta: SURVIVE siempre y 2 distintas al azar de: `power` (encender los cuadros eléctricos, cuenta los `e*` cogidos), `order` (encargo de recepción: G en el mostrador entrega un artefacto del botín, evento `deliver`; el servidor lo quita de la mochila y no lo cobra), `tapes` (objetos del hotel) y `eeh` (a los `goal - EEH_HOLD` s falla el evaporador: el servidor suelta 2 partygoers y una bacteria y hay que aguantar `EEH_HOLD` = 90 s). Cada planta pide más y paga +25 %. **Encadenadas:** cumplida una misión (sale la salida), G en cualquier Faceling (mostrador o los que pasean, `World.nearWalker`) da otra (`nextMission`): la primera de la pizarra sin cumplir y, al final, `climb` («llegar a la planta 5» por la escalera de servicio, solo en plantas < 5; se cumple al elegir la 5 en el selector). Servidor: `r.done` = salida abierta, `r.cur` = la actual cumplida, `r.earned` = suma de lo cobrado (se paga al `finish`); `Match.base` hace que cada misión cuente desde cero. Nadie puede pedir otra si ya ha subido alguien. Falta del EEH: luces rojas, megafonía y Facelings hostiles.

- **Escaleras de servicio reales, 14/11/2026:** sin interfaz. El hueco de hormigón (`World`, bloque `stairsAt`) apila 5 niveles (plantas 1-5 + azotea), cada uno con tramo izquierdo, descansillo, tramo derecho y rellano; la planta de ahora está a y = 0 y las demás por encima y por debajo (`base(k)`). Cada rellano tiene una puerta «FLOOR n» (`World.stairDoors`); cruzarla con la salida abierta llama a `win(true, n)` (servidor: `ascend(inv, n)` → `toFloor`; la misión `climb` se cumple con la 5). `World.floorAt(x, z, y)` ya depende de la altura (el más alto que se alcanza de un paso) y `Player` lo pasa; caer solo cuenta sobre un hueco (`floor === -Infinity`). Quitados `FloorPick`, `openFloor/closeFloor/pickFloor` y `Hud.floors`.
- **Diálogo de misión, 14/11/2026:** G en un Faceling con una misión hecha abre `Dialogue.tsx`: habla con glifos sin sentido y ofrece N opciones, también en glifos; se elige a ciegas (`nextMission(pick, cb)`: `-1` solo pregunta cuántas quedan; con una sola, se acepta sin diálogo).
