import { useEffect, useState, type ReactNode } from 'react';
import { DIFFICULTY, MAX_PLAYERS, ROOM_NAME_MAX, type Difficulty, type RoomSettings, type RoomView } from '@backrooms/shared';
import type { Sock } from '../net';

/*
 * Los ajustes de una sala (nombre, visibilidad, jugadores, semilla y dificultad), como filas de etiqueta y
 * valor. Solo el propietario los cambia; los demás los ven. Los usa la pantalla del ordenador de la sala de espera.
 */

export const DIFF: Record<Difficulty, string> = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD' };

/** Un ajuste de la sala: etiqueta a la izquierda y valor a la derecha. */
export function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="br-set">
      <span className="br-lobby__dim">{label}</span>
      <span className="br-set__val">{children}</span>
    </div>
  );
}

export default function RoomSettingsPanel({ room, me, sock }: { room: RoomView; me: string; sock?: Sock }) {
  const owner = room.ownerId === me;
  const set = (patch: Partial<RoomSettings>) => sock?.emit('settings', patch);
  const [seedText, setSeedText] = useState('');
  // la semilla escrita sigue a la de la sala (la cambia el propietario)
  useEffect(() => setSeedText(room.fixedSeed ? String(room.fixedSeed) : ''), [room.fixedSeed]);
  const diffs = Object.keys(DIFFICULTY) as Difficulty[];
  return (
    <div className="br-settings">
      {!owner && <p className="br-lobby__sub">READ ONLY · ONLY THE OWNER CAN CHANGE THEM</p>}
      <Setting label="NAME">
        {owner ? <input className="br-field" value={room.name} maxLength={ROOM_NAME_MAX} autoComplete="off" onChange={(e) => set({ name: e.target.value })} /> : room.name}
      </Setting>
      <Setting label="VISIBILITY">
        {owner ? (
          <button type="button" className="br-opt" onClick={() => set({ public: !room.public })}>
            ◀ {room.public ? 'PUBLIC' : 'PRIVATE'} ▶
          </button>
        ) : room.public ? 'PUBLIC' : 'PRIVATE'}
      </Setting>
      <Setting label="PLAYERS">
        {owner ? (
          <button type="button" className="br-opt" onClick={() => set({ max: room.max >= MAX_PLAYERS ? Math.max(2, room.players.length) : room.max + 1 })}>
            ◀ {room.max} ▶
          </button>
        ) : room.max}
      </Setting>
      <Setting label="SEED">
        {owner ? (
          <input
            className="br-field br-field--code"
            value={seedText}
            placeholder="RANDOM"
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 9);
              setSeedText(v);
              set({ fixedSeed: Number(v) || 0 });
            }}
          />
        ) : room.fixedSeed || 'RANDOM'}
      </Setting>
      <Setting label="DIFFICULTY">
        {owner ? (
          <button type="button" className="br-opt" onClick={() => set({ difficulty: diffs[(diffs.indexOf(room.difficulty) + 1) % diffs.length] })}>
            ◀ {DIFF[room.difficulty]} ▶
          </button>
        ) : DIFF[room.difficulty]}
        <small className="br-lobby__dim"> MONEY x{DIFFICULTY[room.difficulty].money} · LOOT {Math.round(DIFFICULTY[room.difficulty].loot * 100)}% · {DIFFICULTY[room.difficulty].ents} ENT</small>
      </Setting>
    </div>
  );
}
