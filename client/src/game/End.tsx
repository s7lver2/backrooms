import { type Fate, type RoundResult } from '@backrooms/shared';

/**
 * La pantalla de después de la ronda: NOCLIP si el equipo cumple la misión y alguien vuelve vivo (cobra la recompensa), EJECTED si no
 * (pierde un cuarto del dinero). Con `result` (en una sala) saca el desglose (misión, cobro o penalización, saldo nuevo) y qué fue de ti;
 * y una sola opción: volver a la sala de espera. Sin sala (solo) se queda en el título y el botón.
 */

const FATE: Record<Fate, string> = {
  back: 'YOU RODE THE ELEVATOR UP. YOU KEEP YOUR GEAR.',
  dead: 'YOU DIED DOWN THERE. YOUR GEAR IS LOST.',
  stranded: 'YOU NEVER REACHED THE ELEVATOR. YOUR GEAR IS LOST.',
};

export default function End({ win, result, me, label = 'INSERT TAPE', onInsert }: { win: boolean; result?: RoundResult | null; me?: string; label?: string; onInsert: () => void }) {
  const fate = me ? result?.fates[me] : undefined;
  const r = result;
  // por qué salió mal: sin misión o sin nadie vivo en el ascensor
  const why = !r || r.won ? '' : r.completed ? 'NOBODY CAME BACK ALIVE' : 'MISSION NOT COMPLETED';
  return (
    <div className="br" data-screen="off" data-fell={r?.fell || undefined}>
      <nav className="br-menu" aria-label="Backrooms">
        <h1 className="br-menu__title">{win ? 'NOCLIP' : 'EJECTED'}</h1>
        <p className="br-menu__sub">{win ? 'YOU GOT OUT. THIS TIME.' : why || 'THE TAPE IS OUT OF THE DECK'}</p>
        {r && (
          <dl className="br-end" role="status">
            <dt>MISSION</dt>
            <dd>{r.mission ? `${r.mission.text} · ${r.completed ? 'DONE' : 'FAILED'}` : '-'}</dd>
            <dt>{r.won ? 'REWARD' : 'PENALTY (-25% OF THE BANK)'}</dt>
            <dd data-bad={!r.won || undefined}>{r.won ? `+$${r.reward}` : `-$${r.penalty}`}</dd>
            <dt data-rule>NEW BANK</dt>
            <dd data-rule>${r.bank}</dd>
            {r.floor !== undefined && (
              <>
                <dt>HOTEL</dt>
                <dd data-bad={r.fell || undefined}>{r.fell ? 'THE ELEVATOR FELL. BACK TO FLOOR 1.' : r.floor > 1 ? `NEXT: FLOOR ${r.floor}` : r.won ? 'YOU CLEARED THE HOTEL.' : 'BACK TO FLOOR 1.'}</dd>
              </>
            )}
            {fate && (
              <>
                <dt>YOU</dt>
                <dd data-bad={fate !== 'back' || undefined}>{FATE[fate]}</dd>
              </>
            )}
          </dl>
        )}
        <ul>
          <li>
            <button type="button" className="br-opt" autoFocus onClick={onInsert}>
              {r ? 'BACK TO THE WAITING ROOM' : label}
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
