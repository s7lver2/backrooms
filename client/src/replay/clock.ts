/*
 * El reloj de la repeticion: avanza solo (con requestAnimationFrame) a la velocidad elegida y avisa a quien escucha.
 * Un unico reloj gobierna el render del juego y, mas adelante, el mapa y la timeline del visor.
 */
export class ReplayClock {
  /** ms desde el inicio de la grabacion. */
  t = 0;
  speed = 1;
  playing = true;
  private raf = 0;
  private last = 0;
  private ticks = new Set<(t: number) => void>();
  private seeks = new Set<(t: number) => void>();

  constructor(readonly end: number) {}

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const f = (n: number) => {
      const dt = Math.min(100, n - this.last);
      this.last = n;
      if (this.playing && this.t < this.end) {
        this.t = Math.min(this.end, this.t + dt * this.speed);
        for (const l of this.ticks) l(this.t);
      }
      this.raf = requestAnimationFrame(f);
    };
    this.raf = requestAnimationFrame(f);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  seek(t: number) {
    this.t = Math.max(0, Math.min(this.end, t));
    for (const l of this.seeks) l(this.t);
  }

  onTick(cb: (t: number) => void) {
    this.ticks.add(cb);
    return () => void this.ticks.delete(cb);
  }

  onSeek(cb: (t: number) => void) {
    this.seeks.add(cb);
    return () => void this.seeks.delete(cb);
  }
}
