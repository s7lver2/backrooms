import type { Sock } from '../net';
import type { ReplayChunk, ReplayEvent, ReplayFrame } from './format';
import type { ReplayClock } from './clock';

/*
 * La fuente de eventos de una repeticion: hace de socket (`Sock`) para que el juego real funcione igual que en una partida, pero lo
 * que dispara sale de la grabacion segun el reloj. No envia nada (`emit` no hace nada). El juego la trata como a cualquier
 * socket: `on('players')`, `on('world')`, `on('dead')`...
 *
 * Los relojes de las instantaneas se reescriben: el juego interpola con la hora del emisor frente a la hora de llegada, asi que si
 * se reproduce a otra velocidad (o tras un salto) hay que decirle cuando "habria llegado" cada una, o se estira y se descompone.
 */
type Fn = (...a: unknown[]) => void;
type Streams = 'players' | 'world';

export class ReplaySource {
  /** Para pasarla como `Mp.sock`: es la misma cara que el socket real. */
  readonly sock = this as unknown as Sock;
  /** Mientras la fuente sea de una repeticion, el juego no graba ni manda nada. */
  readonly replay = true;
  readonly connected = true;
  readonly id = '__replay__';
  onSeek?: () => void;
  private h = new Map<string, Set<Fn>>();
  private frames: Record<Streams, ReplayFrame[]> = { players: [], world: [] };
  private events: ReplayEvent[] = [];
  private cur = { players: 0, world: 0, events: 0 };
  private offs: (() => void)[] = [];

  constructor(chunks: ReplayChunk[], private readonly clock: ReplayClock) {
    for (const c of chunks) {
      for (const f of c.frames) if (f.k === 'players' || f.k === 'world') this.frames[f.k].push(f);
      this.events.push(...c.events);
    }
    for (const k of ['players', 'world'] as const) this.frames[k].sort((a, b) => a.t - b.t);
    this.events.sort((a, b) => a.t - b.t);
  }

  /** El juego ya se ha enganchado: el reloj arranca. */
  begin() {
    this.offs.push(this.clock.onTick((t) => this.tick(t)), this.clock.onSeek((t) => this.seek(t)));
    this.seek(this.clock.t);
    this.clock.start();
  }

  end() {
    this.clock.stop();
    for (const f of this.offs) f();
    this.offs = [];
  }

  // ── la cara de socket ────────────────────────────────────────────────────
  on(ev: string, cb: Fn) {
    (this.h.get(ev) ?? this.h.set(ev, new Set()).get(ev)!).add(cb);
    return this;
  }
  off(ev: string, cb?: Fn) {
    cb ? this.h.get(ev)?.delete(cb) : this.h.delete(ev);
    return this;
  }
  emit() {
    return true;
  }
  get volatile() {
    return this;
  }
  timeout() {
    return this;
  }
  disconnect() {
    return this;
  }

  private fire(ev: string, ...a: unknown[]) {
    for (const f of this.h.get(ev) ?? []) f(...a);
  }

  /** Cuando "habria llegado" algo grabado en `t`, segun el reloj y la velocidad. */
  private lag(t: number) {
    return (this.clock.t - t) / Math.max(0.05, this.clock.speed);
  }

  private send(k: Streams, f: ReplayFrame) {
    const lag = this.lag(f.t);
    if (k === 'world') {
      this.fire('world', { ...(f.d as object), t: Date.now() - lag });
      return;
    }
    const now = performance.now() - lag, all = f.d as Record<string, object>;
    const out: Record<string, object> = {};
    for (const id in all) out[id] = { ...all[id], t: now };
    this.fire('players', out);
  }

  private tick(t: number) {
    for (const k of ['players', 'world'] as const) {
      const a = this.frames[k];
      while (this.cur[k] < a.length && a[this.cur[k]].t <= t) this.send(k, a[this.cur[k]++]);
    }
    while (this.cur.events < this.events.length && this.events[this.cur.events].t <= t) {
      const e = this.events[this.cur.events++];
      if (e.k === 'death' && e.id) (this.fire('dead', e.id), this.fire('deathInfo', e.data));
    }
  }

  /** Salta a `t`: se coloca el ultimo estado anterior y los eventos pasados no se repiten. */
  private seek(t: number) {
    for (const k of ['players', 'world'] as const) {
      const a = this.frames[k];
      let i = 0;
      while (i < a.length && a[i].t <= t) i++;
      this.cur[k] = i;
    }
    let j = 0;
    while (j < this.events.length && this.events[j].t <= t) j++;
    this.cur.events = j;
    this.onSeek?.();
    for (const k of ['players', 'world'] as const) {
      const f = this.frames[k][this.cur[k] - 1];
      if (f) this.send(k, f);
    }
  }
}
