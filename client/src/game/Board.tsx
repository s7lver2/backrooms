import { useEffect, useRef, useState } from 'react';
import type { MissionKind, RoomView } from '@backrooms/shared';
import type { Sock } from '../net';
import { avatarUrl } from '../account';
import { Avatar } from './Account';
import { MISSION_ICONS } from './missionIcons';

/*
 * La votación de la misión, a pantalla completa al acabar la entrada por la puerta (fase `starting`): las misiones como cuadrados grandes
 * en el centro, cada uno con su icono, su recompensa y quién la vota (su foto). Pulsar uno lo vota; volver a pulsar el tuyo quita el voto.
 * Es un voto por jugador y hay cuenta atrás. Mientras se vota, el cliente carga el nivel (ver Backrooms.tsx); al cerrarse se enseña la
 * elegida y cuántos han cargado.
 */

/** El icono de cada tipo de misión: trazo fino sin relleno, como el resto del OSD. */
export function MissionIcon({ kind }: { kind: MissionKind }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="square">
      <path d={MISSION_ICONS[kind]} />
    </svg>
  );
}

/** La pizarra de la pared, con el zoom puesto (solo muestra el nivel; no hay nada que pulsar): Esc o E la cierran. */
export function BoardHint({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [onClose]);
  return <p className="br-hint">[ESC] BACK</p>;
}

export default function Board({ room, me, sock }: { room: RoomView; me: string; sock?: Sock }) {
  // la cuenta atrás: el servidor manda los ms que quedan al abrirse; se sigue en local
  const at = useRef({ left: 0, t: 0 });
  const [, tick] = useState(0);
  if (room.vote && at.current.left !== room.vote.left) at.current = { left: room.vote.left, t: performance.now() };
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);
  const winner = room.mission?.id;
  const closed = !!winner;
  const left = closed ? 0 : Math.max(0, Math.ceil((at.current.left - (performance.now() - at.current.t)) / 1000));
  const mine = room.offers.find((o) => o.votes.includes(me))?.id ?? '';
  const who = (id: string) => room.players.find((p) => p.id === id);
  const voters = room.players.length, cast = room.offers.reduce((n, o) => n + o.votes.length, 0);
  const loaded = room.vote?.loaded.length ?? 0;
  const auto = closed && cast === 0 && (room.quota ?? 0) > 0; // el hotel con contrato en marcha: el encargo lo asigna el servidor, no hay nada que votar
  const shown = auto ? room.offers.filter((o) => o.id === winner) : room.offers;
  return (
    <aside className="br-board" role="dialog" aria-label="Mission vote">
      <p className="br-board__bar">
        <span>{auto ? "TODAY'S JOB" : 'MISSION VOTE'}</span>
        <span className="br-lobby__dim">ROUND {room.round}</span>
        <span aria-live="off">{closed ? 'CLOSED' : `${String(left).padStart(2, '0')}S`}</span>
      </p>
      <p className="br-lobby__dim br-board__sub">
        {auto ? `ASSIGNED · LOADING THE LEVEL ${loaded}/${voters} READY` : closed ? `${room.mission!.text} · LOADING THE LEVEL ${loaded}/${voters} READY` : `PICK TODAY'S JOB. ${cast}/${voters} VOTED. A TIE IS DRAWN AT RANDOM. THE LEVEL LOADS WHILE YOU VOTE.`}
      </p>
      <ul className="br-board__grid">
        {shown.map((o, i) => (
          <li key={o.id}>
            <button type="button" className="br-tile" disabled={closed} data-on={o.id === mine || undefined} data-lead={(closed ? o.id === winner : o.id === room.leading) || undefined} aria-pressed={o.id === mine} onClick={() => sock?.emit('vote', o.id === mine ? '' : o.id)}>
              <span className="br-tile__top">
                <span className="br-lobby__dim">{String(i + 1).padStart(2, '0')}</span>
                <span className="br-tile__tag">{closed ? (o.id === winner ? 'CHOSEN' : '') : o.id === mine ? 'YOUR VOTE' : o.id === room.leading ? 'LEADING' : ''}</span>
              </span>
              <span className="br-tile__ic">
                <MissionIcon kind={o.kind} />
              </span>
              <b className="br-tile__t">{o.text}</b>
              <span className="br-tile__pay">
                <span className="br-lobby__dim">REWARD</span> ${o.reward}
              </span>
              <span className="br-tile__votes" aria-label={`${o.votes.length} votes`}>
                {o.votes.map((id) => {
                  const p = who(id);
                  return <Avatar key={id} src={p ? avatarUrl(p.avatar) : undefined} name={p?.name} />;
                })}
                <span className="br-tile__n">{o.votes.length ? `×${o.votes.length}` : 'NO VOTES'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
