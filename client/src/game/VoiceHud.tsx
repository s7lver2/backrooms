import type { RoomView } from '@backrooms/shared';
import { settings } from '../settings';
import { useVoice } from '../voice';

/** El estado del chat de voz, abajo a la izquierda: tu micrófono y quién está hablando. Solo en una sala y con la voz encendida. */
export default function VoiceHud({ room, me }: { room: RoomView; me: string }) {
  const v = useVoice();
  if (!settings.voiceMode || room.players.length < 2) return null;
  const talking = room.players.filter((p) => v.speaking.has(p.id));
  return (
    <div className="br-voice" aria-live="polite">
      <span className="br-voice__mic" data-on={v.talking || undefined} data-bad={v.state === 'denied' || undefined}>
        {v.state === 'denied' ? 'MIC BLOCKED' : settings.voiceMode === 1 ? (v.talking ? '● TALKING' : '○ HOLD [V]') : v.talking ? '● MIC OPEN' : '○ MIC'}
      </span>
      {talking.filter((p) => p.id !== me).map((p) => (
        <span key={p.id} className="br-voice__who">▮ {p.name}</span>
      ))}
    </div>
  );
}
