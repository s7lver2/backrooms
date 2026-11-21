# Sistema de repeticiones — diseño

Estado: borrador para revisión (2026-11-21). Nada implementado.

## Intención

Un motor de repeticiones de uso general, al estilo de los juegos competitivos. Sirve a la vez para:
1. **Visor completo** (desde el perfil/menú): rever una partida con cámara libre, POV de cualquier jugador, timeline y export.
2. **Repetición de muerte**: al morir, salta una repetición corta y humorística de cómo moriste.
3. **Compilación de fin de ronda**: 1–2 clips graciosos antes de la escena del podio.

Una sola grabación y un solo motor alimentan los tres usos.

## Objetivos

- Grabar siempre (si el ajuste está activo) sin notarse en el rendimiento.
- Ver la partida desde cualquier punto: cámara libre sobre todas las capas verticales del mapa, y POV de cada jugador.
- Timeline con avance/retroceso, velocidad variable y marcadores (muertes, golpes, casi muertes, ascensor...).
- Exportar fragmentos como vídeo o GIF.
- Repetición de muerte con humor, y con hueco reservado para la personalización futura de perfiles.
- Compilación automática antes del podio.

## No-objetivos (por ahora)

- Almacenar o compartir repeticiones en el servidor, enlaces públicos.
- Perfiles con banner, insignias y capa superior reales (solo se reserva el hueco y la estructura de datos).
- Personalización de los textos/efectos de la repetición de muerte.
- Marcar clips a mano durante la partida (la compilación es automática).

## Anti-objetivos (fallaría aunque «funcione»)

- Que grabar baje los FPS o suba el uso de memoria de forma perceptible.
- Que el modo repetición pueda enviar entradas al servidor o dar ventaja en una partida en curso.
- Que una repetición no se parezca al juego (modelos, efectos, sonido distintos).

## Decisiones tomadas (por el usuario)

| Tema | Decisión |
|---|---|
| Almacenamiento | **Solo en el navegador** (IndexedDB). Sin servidor. Compartir = exportar/importar archivo `.replay`. |
| Motor | **Híbrido**: visor ligero con mapa y timeline (B) que **contiene** el render real del juego (A) como vista. |
| Repetición de muerte | Salta **siempre**, ~6 s, cámara lenta + zoom + efecto humorístico, se salta con una tecla, desactivable. |
| Lateral de la repetición de muerte | Muestra **a los dos**: víctima y quien la mató (si fue el entorno, solo la víctima). Banner + 3 insignias + capa superior por cada uno. |
| Compilación | **Automática**: 1–2 clips de 5–8 s con rótulo gracioso, antes del podio. |
| Export | Vídeo WebM (MP4 si el navegador lo permite), 720p, ≤30 s, con audio. GIF 480p, ≤10 s. Rango elegido arrastrando en la timeline. |
| Retención | Últimas 10 partidas; las marcadas con estrella no caducan. |

## Alternativas consideradas

- **A. Reproducir en el juego real**: máxima fidelidad, pero exige aislar la red de `game.ts` y deja el análisis (mapa, timeline) sin interfaz propia.
- **B. Visor ligero aparte**: sin riesgo para el juego, pero no se parece al juego y no sirve para los clips graciosos.
- **C. Híbrida (elegida)**: el visor (B) aporta mapa multicapa, timeline y lista de jugadores; el render del juego (A) es una de sus vistas y se usa a pantalla completa para la repetición de muerte y la compilación.

## Arquitectura

### Qué hay hoy (verificado)

- El servidor difunde por socket a la sala: `players` a 15 Hz y `world` (entidades, drops, snapshot) a 10 Hz; más eventos sueltos (`dead`, `adminFx`, `blastFx`, `rlog`...).
- `game.ts` los consume con `socket.on(...)`. `End.tsx` es la pantalla de final de ronda.
- Con grabación en cliente no hace falta tocar el servidor.

### Piezas

1. **Grabador** (`replay/recorder.ts`): se engancha a los mismos eventos que `game.ts` recibe. Guarda:
   - Cabecera: versión de formato, versión de build, nivel, planta, semilla, jugadores, hora.
   - Fotogramas `players` y `world` (delta respecto al anterior) y un **fotograma clave cada ~5 s** para poder saltar en la timeline.
   - Eventos con marca de tiempo: muertes (con causa y autor), golpes, daño, casi muertes, ascensor, objetos usados.
   - La cámara **propia** (posición, yaw, pitch) a 30 Hz, para que tu POV sea exacto aunque la red va a 15 Hz.
   - Compresión con `CompressionStream` (gzip) por bloques. Escritura en segundo plano a IndexedDB; en memoria solo un búfer circular reciente.
2. **Almacén** (`replay/store.ts`): IndexedDB con metadatos (lista rápida) separados de los bloques. Rotación de las últimas 10; estrella = no caduca. Importar/exportar `.replay`. Si la versión de build difiere, se marca como «versión antigua» (ver riesgos).
3. **Fuente de eventos** (`NetSource`): interfaz mínima (`on(evento, cb)`) con dos implementaciones, el socket real y `ReplaySource`. `game.ts` recibe una fuente en lugar de usar el socket directamente. En modo repetición: no emite nada, la entrada está desactivada y la cámara la controla el visor.
4. **Reproductor** (`ReplaySource` + reloj): avanza, pausa, velocidad (0,25×–4×), salto con fotogramas clave, interpolación entre fotogramas. El mismo reloj gobierna el render del juego y el mapa del visor.
5. **Controlador de cámara** del render: libre (vuelo, atraviesa capas), POV de un jugador, orbital sobre un jugador, y las cámaras guionizadas de la muerte y la compilación.
6. **Visor** (React, `replay/Viewer.tsx`): mapa multicapa con selector vertical de planta, timeline con marcadores y selección de rango, lista de jugadores para entrar en su POV, botón de export. El render del juego va como vista principal o en recuadro; se pueden intercambiar.
7. **Repetición de muerte** (`replay/DeathCam.tsx`): reproduce los últimos ~6 s del búfer en memoria, en cámara lenta con zoom y efecto humorístico, con el lateral para los perfiles.
8. **Compilación** (`replay/highlights.ts`): puntúa eventos y elige 1–2 momentos de 5–8 s sin solaparse; los reproduce antes del podio en `End.tsx`.
9. **Export** (`replay/export.ts`): el reproductor avanza fotograma a fotograma (no en tiempo real) para una salida estable. Vídeo con `MediaRecorder` sobre `canvas.captureStream`; GIF con un codificador en un worker.

### Estructura reservada para perfiles

```ts
type ProfileCard = {
  uid?: string; name: string;
  banner?: string;           // id de banner
  badges: [string?, string?, string?]; // 3 insignias
  layer?: string;            // capa superior
};
```
El lateral de la cámara de muerte pinta dos `ProfileCard` con huecos fijos. Hoy se rellenan con valores por defecto (nombre y color); cuando lleguen los perfiles solo cambian los datos.

### Puntuación de momentos (compilación)

Pesos iniciales, ajustables: muerte absurda (caída, trampa, con objeto en mano) > casi muerte (sobrevivir con 1 de vida) > golpe entre jugadores > susto de entidad. Se penaliza lo repetido (no dos clips del mismo tipo) y lo muy cercano en el tiempo. Los rótulos salen de plantillas por tipo de evento.

## Interfaz (mockups)

Ver los mockups adjuntos: visor completo, repetición de muerte con lateral, timeline con marcadores y pantalla de compilación.

## Riesgos y preguntas abiertas

- **Versión de build**: si el juego cambia modelos, mapa o formato, una repetición antigua puede no reproducirse bien. Decisión propuesta: guardar la versión; si no coincide, avisar y reproducir en modo degradado (mapa y timeline sí; render del juego solo si el formato es compatible).
- **Mapas generados por semilla** (Poolrooms y el resto): para el mapa y el render hay que regenerar la geometría desde la semilla; si el generador cambia entre versiones, la repetición se desajusta. Misma mitigación.
- **Datos de otros jugadores**: lo que llega por `players` puede no incluir pitch/yaw completos; para el POV de otros se interpola con lo disponible. A verificar en la implementación; si falta, el POV ajeno usa dirección de movimiento.
- **Visibilidad**: si el servidor filtrara entidades por jugador, la cámara libre solo vería lo que vio el grabador. Hoy se difunde todo a la sala.
- **Memoria y disco**: estimación 1–3 MB por partida comprimida; se mide en la implementación y se ajusta la frecuencia de los fotogramas clave.
- **Ajuste «guardar repeticiones»**: el usuario pidió que fuera de la cuenta. Como el almacén es local, el ajuste empieza siendo local al dispositivo (decisión del diseñador; sincronizarlo con la cuenta es trivial más adelante).

## Fases propuestas

1. Grabador + almacén + `NetSource` (sin interfaz): se graba y se guarda.
2. Reproductor + render del juego en modo repetición + cámara libre/POV.
3. Visor con mapa multicapa y timeline con marcadores.
4. Repetición de muerte con lateral reservado.
5. Compilación antes del podio.
6. Export a vídeo/GIF e importar/exportar `.replay`.
