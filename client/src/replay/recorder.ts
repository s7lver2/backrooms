import type { DeathInfo, Inventory, PlayerState } from '@backrooms/shared';
import type { Sock } from '../net';
import { MAX_BYTES, REPLAY_BUILD, REPLAY_FORMAT, type ReplayChunk, type ReplayEvent, type ReplayFrame, type ReplayMeta } from './format';
import { putChunk, putMeta, rotate } from './store';
import { renderThumb } from './thumb';

/*
 * Graba la partida desde los mismos eventos de socket que el juego ya recibe (el servidor difunde todo a la sala):
 * `players` a 15 Hz, `world` a 10 Hz, las muertes y los estallidos; mas mi camara exacta (`own`) cada vez que se manda mi estado.
 * Sin deltas: cada fotograma va entero y cada bloque (5 s) se comprime con gzip, que se come la repeticion. En memoria solo
 * queda la cola reciente (`tail`, para la repeticion de muerte); los bloques cerrados se escriben en segundo plano.
 */
const CHUNK_MS = 5000;
const TAIL_MS = 15000;
type Players = Record<string, PlayerState & { name: string; dead: boolean; hp?: number }>;

export class Recorder {
  readonly meta: ReplayMeta;
  private readonly t0 = performance.now();
  private frames: ReplayFrame[] = [];
  private events: ReplayEvent[] = [];
  private mark = 0;
  private n = 0;
  private recent: { frames: ReplayFrame[]; events: ReplayEvent[] } = { frames: [], events: [] };
  private hp = new Map<string, number>();
  private names = new Map<string, string>();
  private q: Promise<void> = Promise.resolve();
  private off: (() => void)[] = [];
  private dead = false;
  private stopped = false;
  // para la miniatura: el recorrido [x, z, y] y las muertes [x, z]
  private trace: number[][] = [];
  private deaths: number[][] = [];
  private lastAll: Players = {};
  private tTrace = -1e9;
  private tStat = -1e9;

  constructor(
    private readonly sock: Sock,
    info: { me?: string; levelId: string; floor?: number; seed: number },
  ) {
    this.meta = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, v: REPLAY_FORMAT, build: REPLAY_BUILD, started: Date.now(), durationMs: 0, players: [], starred: false, size: 0, ...info };
    const s = sock;
    const onPlayers = (all: Players) => {
      this.frame('players', all);
      this.lastAll = all;
      for (const id in all) {
        this.names.set(id, all[id].name);
        const hp = all[id].hp;
        const was = this.hp.get(id);
        if (hp !== undefined) {
          if (was !== undefined && hp < was) this.event('hurt', id, { hp, was });
          this.hp.set(id, hp);
        }
      }
    };
    const onWorld = (w: unknown) => this.frame('world', w);
    const onDeath = (d: DeathInfo) => {
      const p = this.lastAll[d.id];
      if (p) this.deaths.push([p.x, p.z]);
      this.meta.hl ??= this.now();
      this.event('death', d.id, d);
    };
    const onInv = (i: Inventory) => this.event('inv', this.meta.me, i);
    const onBlast = (m: unknown) => this.event('fx', undefined, { k: 'blast', m });
    s.on('players', onPlayers);
    s.on('world', onWorld);
    s.on('deathInfo', onDeath);
    s.on('blastFx', onBlast);
    s.on('inv', onInv);
    this.off.push(() => (s.off('players', onPlayers), s.off('world', onWorld), s.off('deathInfo', onDeath), s.off('blastFx', onBlast), s.off('inv', onInv)));
    this.q = putMeta(this.meta).then(() => rotate(this.meta.id)).catch(() => this.kill());
  }

  private now() {
    return Math.round(performance.now() - this.t0);
  }

  private frame(k: ReplayFrame['k'], d: unknown) {
    if (this.dead || this.stopped) return;
    const f = { t: this.now(), k, d };
    this.frames.push(f);
    this.recent.frames.push(f);
    this.step();
  }

  private event(k: ReplayEvent['k'], id: string | undefined, data?: unknown) {
    if (this.dead || this.stopped) return;
    const e = { t: this.now(), k, id, data };
    this.events.push(e);
    this.recent.events.push(e);
  }

  /** Mi camara tal cual (la de verdad, no la que llega por la red). */
  own(x: number, y: number, z: number, yaw: number, pitch: number, stats?: [number, number, number]) {
    const r = (v: number) => Math.round(v * 1000) / 1000;
    this.frame('own', [r(x), r(y), r(z), r(yaw), r(pitch)]);
    const t = this.now();
    if (t - this.tTrace >= 400 && this.trace.length < 3000) (this.tTrace = t), this.trace.push([x, z, y]);
    if (stats && t - this.tStat >= 500) (this.tStat = t), this.event('stat', this.meta.me, stats.map((v) => Math.round(v * 100) / 100));
  }

  /** Lo ultimo de `ms` milisegundos, para la repeticion de muerte. */
  tail(ms: number) {
    const from = this.now() - ms;
    return { frames: this.recent.frames.filter((f) => f.t >= from), events: this.recent.events.filter((e) => e.t >= from) };
  }

  private step() {
    const t = this.now();
    const cut = t - TAIL_MS;
    if (this.recent.frames[0] && this.recent.frames[0].t < cut - 2000) {
      this.recent.frames = this.recent.frames.filter((f) => f.t >= cut);
      this.recent.events = this.recent.events.filter((e) => e.t >= cut);
    }
    if (t - this.mark >= CHUNK_MS) this.flush(t);
  }

  /** Cierra el bloque actual: se comprime y se escribe en segundo plano (la cola los guarda en orden). */
  private flush(t: number) {
    const chunk: ReplayChunk = { from: this.mark, to: t, key: true, frames: this.frames, events: this.events };
    this.frames = [];
    this.events = [];
    this.mark = t;
    const i = this.n++;
    this.q = this.q
      .then(async () => {
        if (this.dead) return;
        const body = new Blob([JSON.stringify(chunk)]).stream().pipeThrough(new CompressionStream('gzip'));
        const blob = await new Response(body).blob();
        await putChunk(this.meta.id, i, blob);
        this.meta.size += blob.size;
        this.meta.durationMs = t;
        this.meta.players = [...this.names].map(([id, name]) => ({ id, name }));
        if (this.meta.size > MAX_BYTES) ((this.meta.truncated = true), this.kill());
        await putMeta(this.meta);
      })
      .catch(() => this.kill());
  }

  private kill() {
    this.dead = true;
    this.frames = [];
    this.events = [];
    for (const f of this.off) f();
    this.off = [];
  }

  /** Fin de la partida: lo que quedaba sin cerrar se guarda y se devuelve el id (o `null` si no se pudo grabar). */
  async stop(): Promise<string | null> {
    const first = !this.stopped;
    this.stopped = true;
    for (const f of this.off) f();
    this.off = [];
    if (first && !this.dead && (this.frames.length || this.events.length)) this.flush(this.now());
    await this.q;
    if (first && !this.dead && this.trace.length) {
      this.meta.hl ??= this.meta.durationMs;
      const end = this.trace[this.trace.length - 1];
      this.meta.thumb = renderThumb(this.meta, { path: this.trace, deaths: this.deaths, end });
      await putMeta(this.meta).catch(() => {});
    }
    return this.dead && !this.meta.truncated ? null : this.meta.id;
  }
}
