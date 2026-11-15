# Capacidades por nivel (LevelCaps)

El jugador es un «prefab» con componentes (inventario, nadar/bombona/pistola de agua, caída, cordura, linterna, radar...). El **servidor** decide qué componentes están activos en cada nivel con la tabla `LEVEL_CAPS` de `shared/src/caps.ts` (`levelCaps(levelId)`; nivel desconocido = level0).

- `pool`: mapa de piscinas (Poolrooms) en vez del laberinto. `ents`: entidades y tótem. `fall`: caer al vacío mata (`'fell'`). `insane`: la cordura mata (`'insane'`). `swim`: nadar, bombona y pistola de agua.
- `RoomView.caps` va en cada vista de sala (match-start/snapshot); el cliente lo guarda en `Game.caps` (vía `Mp.caps`).
- El servidor ignora `fell`/`insane` si el nivel no los tiene; el cliente ni los emite. No hay `levelId === 'poolrooms'` por ahí: se pregunta a `caps`.
- El inventario/equipo es del jugador y persiste entre niveles; un nivel que no usa un componente solo lo desactiva, nunca lo quita.
- Nivel nuevo: añadir una entrada en `LEVEL_CAPS` (y en `LEVELS` de missions.ts). Capacidad nueva: un campo en `LevelCaps` + su valor en cada nivel.

## Final de ronda (prefab)
`client/src/game/epilogue.ts` es el final de una ronda ganada, igual en todos los niveles: fila de jugadores con su pose de victoria (la elegida en el armario) y entidades bailando detrás. Un nivel nuevo solo monta su `Stage` (escena, cámara, `solid`) en `Game.epilogue()`; el resto es del prefab.
