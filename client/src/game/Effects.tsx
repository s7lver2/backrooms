import type { Hud } from './game';

/*
 * Los efectos del personaje, positivos (verde) y negativos (rojo): un cuadradito con su icono; si dura un tiempo, una barra que se vacía.
 * Game.effects() decide cuáles hay en cada momento; aquí solo se pintan. Un efecto nuevo: añadir su `icon` aquí y su condición allí.
 */
/** Cada icono: [contorno, relleno suave (opcional)] en una cuadrícula de 24. */
const ICON: Record<string, [string, string?]> = {
  speed: ['M13 2 5 13.5h6L10 22l9-12h-6.5z M2 8h3 M1 12h2.5 M3 16h3', 'M13 2 5 13.5h6L10 22l9-12h-6.5z'],
  wet: ['M12 3c4 5 6.5 8 6.5 11a6.5 6.5 0 0 1-13 0c0-3 2.5-6 6.5-11z M8.5 14.5a3.5 3.5 0 0 0 3 3.5', 'M12 3c4 5 6.5 8 6.5 11a6.5 6.5 0 0 1-13 0c0-3 2.5-6 6.5-11z'],
  stun: ['M12 3l2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9L9.6 8z M3 21l2-2 M21 21l-2-2', 'M12 3l2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9L9.6 8z'],
  shield: ['M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z M8.5 12l2.5 2.5 4.5-5', 'M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z'],
  tired: ['M3 7.5h15v9H3z M18 10.5h3v3h-3z M5.5 10h3', 'M3 7.5h15v9H3z'],
  air: ['M12 3v9 M12 12c-2.5 0-6.5 1.5-7 6 0 2.5 3.5 3 5.5.5L12 15 M12 12c2.5 0 6.5 1.5 7 6 0 2.5-3.5 3-5.5.5L12 15', 'M12 12c-2.5 0-6.5 1.5-7 6 0 2.5 3.5 3 5.5.5L12 15z M12 12c2.5 0 6.5 1.5 7 6 0 2.5-3.5 3-5.5.5L12 15z'],
  nosignal: ['M12 21V10 M7 6a7 7 0 0 1 10 0 M9.5 9a3.5 3.5 0 0 1 5 0 M3 3l18 18'],
  hide: ['M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12z M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0', 'M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0'],
  panic: ['M12 3 2 20.5h20z M12 10v5 M12 17.6v.4', 'M12 3 2 20.5h20z'],
};

export default function Effects({ list }: { list: Hud['effects'] }) {
  if (!list.length) return null;
  return (
    <div className="br-fxs" aria-label="Active effects">
      {list.map((e) => (
        <div key={e.id} className="br-fx" data-kind={e.kind} title={e.label}>
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {(ICON[e.icon] ?? ICON.panic)[1] && <path d={(ICON[e.icon] ?? ICON.panic)[1]} fill="currentColor" fillOpacity="0.28" stroke="none" />}
            <path d={(ICON[e.icon] ?? ICON.panic)[0]} />
          </svg>
          {e.frac !== undefined && <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, e.frac))})` }} />}
          <small>{e.label}</small>
        </div>
      ))}
    </div>
  );
}
