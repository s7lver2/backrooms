import { useEffect } from 'react';
import type { ProfileCard } from './profile';
import './viewer.css';

/*
 * La capa encima del juego mientras se reproduce una grabacion dentro de la partida: la repeticion de muerte (rotulo, vineta y el
 * lateral con las fichas de la victima y el asesino) y la compilacion de fin de ronda (rotulo, progreso y saltar al podio).
 * Los huecos del banner, las 3 insignias y la capa superior estan reservados en cada ficha (ver profile.ts).
 */
export type FeedUi = { kind: 'death' | 'clip'; caption: string; left?: ProfileCard; right?: ProfileCard; n?: number; of?: number };

function Card({ c, role }: { c: ProfileCard; role: string }) {
  return (
    <aside className="rp-card" style={{ ['--c' as string]: c.color }}>
      <div className="rp-card__banner" data-slot="banner">{c.banner ?? ''}</div>
      <b>{c.name}</b>
      <span className="rp-dim">{role}</span>
      <div className="rp-card__badges">
        {[0, 1, 2].map((i) => <i key={i} data-slot="badge">{c.badges[i] ?? ''}</i>)}
      </div>
      <div className="rp-card__layer" data-slot="layer">{c.layer ?? ''}</div>
    </aside>
  );
}

export function Feed({ ui, onSkip, onSkipAll }: { ui: FeedUi; onSkip: () => void; onSkipAll: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space') (e.preventDefault(), onSkip());
      else if (e.code === 'Escape') (e.preventDefault(), onSkipAll());
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onSkip, onSkipAll]);
  return (
    <div className="rp-feed" data-kind={ui.kind} role="status" aria-live="polite">
      {ui.kind === 'death' && <div className="rp-vig" aria-hidden="true" />}
      {ui.kind === 'death' && ui.left && <div className="rp-feed__l"><Card c={ui.left} role="DOWN" /></div>}
      {ui.kind === 'death' && ui.right && <div className="rp-feed__r"><Card c={ui.right} role="TOOK THEM OUT" /></div>}
      <p className="rp-cap" key={ui.caption}>{ui.caption}</p>
      <div className="rp-feed__bar">
        {ui.kind === 'clip' && <span>BEST OF THE ROUND · {ui.n}/{ui.of}</span>}
        <button type="button" className="br-opt" onClick={onSkip}>{ui.kind === 'death' ? 'SKIP · SPACE' : ui.n === ui.of ? 'TO THE PODIUM · SPACE' : 'NEXT · SPACE'}</button>
        {ui.kind === 'clip' && ui.n !== ui.of && <button type="button" className="br-opt" onClick={onSkipAll}>TO THE PODIUM · ESC</button>}
      </div>
    </div>
  );
}
