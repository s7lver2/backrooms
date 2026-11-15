import { useEffect, useState } from 'react';
import { ACHIEVEMENTS, EMOTE_DEFS, EMOTE_SLOTS, emoteOpen } from '@backrooms/shared';
import { emoteGate, onEmotes, previewEmote, setVictory, toggleEmote } from './emotes';

/*
 * El armario, parte de los bailes: de todos los emotes solo se llevan EMOTE_SLOTS equipados (los de la rueda B y las teclas 1–5) y uno de ellos es la
 * pose de victoria (★) que hace tu personaje al acabar una ronda ganada. Pulsar un emote lo equipa o lo quita; la estrella lo elige de pose.
 */
const need = (key: string | null) => ACHIEVEMENTS.find((a) => a.key === key)?.name ?? '';

export default function EmoteLoadout() {
  const [, tick] = useState(0);
  const [msg, setMsg] = useState('');
  useEffect(() => onEmotes(() => tick((n) => n + 1)), []);
  const eq = emoteGate.equipped;
  return (
    <div className="br-ward__row">
      <p className="br-ward__h">
        <span>EMOTES · CLICK TO PREVIEW</span>
        <span className="br-lobby__dim">{eq.length}/{EMOTE_SLOTS} EQUIPPED · ★ = VICTORY POSE</span>
      </p>
      <div className="br-boxes br-emotes" role="group" aria-label="Emotes">
        {EMOTE_DEFS.map((d, i) => {
          const n = i + 1, open = emoteOpen(n, emoteGate.have), on = eq.includes(n), win = emoteGate.victory === n;
          return (
            <span key={d.name} className="br-emo" data-on={on || undefined} data-locked={!open || undefined}>
              <button
                type="button"
                className="br-emo__b"
                aria-pressed={on}
                aria-disabled={!open || undefined}
                title={open ? (on ? 'Unequip' : 'Equip') : `LOCKED · EARN ${need(d.need)}`}
                onClick={() => (open && previewEmote(n), setMsg(!open ? `LOCKED · EARN ${need(d.need)}` : toggleEmote(n) ? '' : `ONLY ${EMOTE_SLOTS} AT A TIME · UNEQUIP ONE FIRST`))}
              >
                <span>{d.name}</span>
                <small>{open ? (on ? `SLOT ${eq.indexOf(n) + 1}` : 'FREE') : 'LOCKED'}</small>
              </button>
              {on && (
                <button type="button" className="br-emo__s" aria-pressed={win} aria-label={`Victory pose: ${d.name}`} title="Victory pose" onClick={() => setVictory(n)}>
                  {win ? '★' : '☆'}
                </button>
              )}
            </span>
          );
        })}
      </div>
      {msg && <p className="br-lobby__sub" role="alert" data-bad>{msg}</p>}
    </div>
  );
}
