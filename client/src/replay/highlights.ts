import { HP_MAX, type DeathInfo } from '@backrooms/shared';
import { deathCaption, nearCaption } from './captions';
import type { ReplayEvent, ReplayMeta } from './format';

/*
 * La compilacion de fin de ronda: puntua los momentos de la grabacion y elige 1-2 clips de unos 6 s que no se pisen.
 * Muerte absurda (el entorno) > casi muerte (la vida bajo del 20 % y sigue vivo) > fuego amigo > susto de entidad.
 */
export type Clip = { from: number; to: number; kind: 'absurd' | 'near' | 'hit' | 'scare'; caption: string; focus: string; score: number };

const WEIGHT = { absurd: 100, near: 70, hit: 60, scare: 45 } as const;
const GAP = 10000;

export function pickClips(events: ReplayEvent[], meta: ReplayMeta, me: string | undefined, max = 2): Clip[] {
  const name = (id: string) => meta.players.find((p) => p.id === id)?.name ?? '???';
  const deaths = events.filter((e) => e.k === 'death' && e.id);
  const all: Clip[] = [];
  for (const e of deaths) {
    const info = e.data as DeathInfo, id = e.id!, by = info.by;
    const kind = by?.kind === 'player' ? 'hit' : by?.kind === 'entity' ? 'scare' : 'absurd';
    all.push({ from: Math.max(0, e.t - 5000), to: Math.min(meta.durationMs, e.t + 1000), kind, focus: id, caption: deathCaption(info, name(id), by?.kind === 'player' ? name(by.id) : undefined), score: WEIGHT[kind] });
  }
  const lastNear = new Map<string, number>();
  for (const e of events) {
    if (e.k !== 'hurt' || !e.id) continue;
    const hp = (e.data as { hp: number }).hp;
    // salvarse por poco: poca vida y sin morir en los 6 s siguientes
    if (hp <= 0 || hp > HP_MAX * 0.2 || e.t - (lastNear.get(e.id) ?? -1e9) < 8000 || deaths.some((d) => d.id === e.id && d.t >= e.t && d.t - e.t < 6000)) continue;
    lastNear.set(e.id, e.t);
    all.push({ from: Math.max(0, e.t - 3000), to: Math.min(meta.durationMs, e.t + 3500), kind: 'near', focus: e.id, caption: nearCaption(name(e.id)), score: WEIGHT.near });
  }
  for (const c of all) if (c.focus === me) c.score += 20; // (lo mas gracioso es lo tuyo)
  // codicioso: el mejor que no pise a los ya elegidos; repetir tipo vale un 40 % menos (se prefiere variedad)
  const out: Clip[] = [];
  const ok = all.filter((c) => c.to - c.from >= 2500);
  while (out.length < max) {
    const best = ok
      .filter((c) => !out.includes(c) && out.every((o) => Math.abs(o.from - c.from) >= GAP))
      .sort((a, b) => b.score * (out.some((o) => o.kind === b.kind) ? 0.6 : 1) - a.score * (out.some((o) => o.kind === a.kind) ? 0.6 : 1))[0];
    if (!best) break;
    out.push(best);
  }
  return out.sort((a, b) => a.from - b.from);
}
