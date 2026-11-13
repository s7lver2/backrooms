/*
 * El sonido de las backrooms, todo sintetizado (como el ordenador, pcAudio.ts): el zumbido de los
 * fluorescentes (120 Hz con armónicos y un ruido que respira), el siseo de la cinta, pasos sobre
 * moqueta, cada entidad con su sonido (más fuerte cuanto más cerca), el disparo, el obturador,
 * recoger algo y el ascensor. `corrupt` lo distorsiona y lo corta todo, como una cinta que se come.
 */
import { settings } from '../settings';

/** El audio vivo, para que la interfaz (React) pueda sonar sin tenerlo a mano: `sound('buy')`. */
let live: GameAudio | undefined;
type Cue = 'ui' | 'buy' | 'sell' | 'upgrade' | 'bag' | 'bagClose' | 'equip' | 'hurt' | 'denied';
export const sound = (k: Cue) => live?.cue(k);

export class GameAudio {
  readonly ctx: AudioContext;
  private out: GainNode;
  private master: GainNode; // el volumen del menú: 0 con el sonido quitado (corrupt() toca `out`, no este)
  private shaper: WaveShaperNode;
  private amb: GainNode; // el fondo (zumbido, ventilación, siseo): el ajuste AMBIENT
  private sfx: GainNode; // lo puntual (pasos, disparo, entidades…): el ajuste EFFECTS
  private noise: AudioBuffer;
  private nearNext = { bacteria: 0, partygoer: 0 };
  private nodes: AudioNode[] = [];

  private vol = 1;
  private muted = false;

  constructor(ctx?: AudioContext, muted = false, volume = 1) {
    this.ctx = ctx ?? new AudioContext();
    const c = this.ctx;
    this.vol = volume;
    this.muted = muted;
    this.shaper = c.createWaveShaper();
    this.out = c.createGain();
    this.out.gain.value = 1.1;
    this.master = c.createGain();
    this.master.gain.value = muted ? 0 : volume;
    this.amb = c.createGain();
    this.sfx = c.createGain();
    this.amb.connect(this.shaper);
    this.sfx.connect(this.shaper);
    this.setMix();
    // un compresor antes de la salida: se puede subir todo sin que varios sonidos a la vez saturen
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.shaper.connect(comp);
    comp.connect(this.out);
    this.out.connect(this.master);
    this.master.connect(c.destination);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    live = this;
    document.addEventListener('click', this.onClick, true);
  }

  /** Cualquier botón de la interfaz hace su clic (los del juego ya suenan por su cuenta: solo botones y casillas). */
  private onClick = (e: MouseEvent) => {
    if ((e.target as Element | null)?.closest?.('button, [role=button], [role=treeitem], .iv-slot, .iv-cell')) this.cue('ui');
  };

  /** Los sonidos de la interfaz y de los hechos del juego (compra, venta, mejora…). */
  cue(k: Cue) {
    switch (k) {
      case 'ui':
        this.burst(0.02, 0.35, 3200, 3, 'bandpass');
        this.tone(1500, 0.05, 0.08, 'square', 0, 900);
        break;
      case 'buy': // una moneda que cae
        this.tone(1568, 0.1, 0.16, 'triangle');
        this.tone(2093, 0.4, 0.14, 'triangle', 0.07);
        break;
      case 'sell': // la caja registradora: el timbre y las monedas
        this.burst(0.04, 0.5, 5000, 2, 'bandpass');
        [0, 0.06, 0.12, 0.18].forEach((t, i) => this.tone([1318, 1568, 1976, 2637][i], 0.35, 0.14, 'triangle', t));
        this.tone(3136, 0.8, 0.07, 'sine', 0.2);
        break;
      case 'upgrade': // un arpegio que sube
        [0, 0.09, 0.18, 0.27].forEach((t, i) => (this.tone([392, 494, 587, 784][i], 0.5, 0.16, 'triangle', t), this.tone([392, 494, 587, 784][i] * 2, 0.5, 0.05, 'sine', t)));
        break;
      case 'bag': // la mochila que se abre: un roce de tela
        this.burst(0.18, 0.3, 700, 1.1, 'bandpass');
        this.burst(0.1, 0.2, 2200, 2, 'bandpass', 0.07);
        break;
      case 'bagClose':
        this.burst(0.14, 0.25, 500, 1.1, 'bandpass');
        break;
      case 'equip': // un clac metálico
        this.burst(0.03, 0.5, 1800, 4, 'bandpass');
        this.tone(320, 0.08, 0.15, 'square', 0.02, 180);
        break;
      case 'hurt':
        this.burst(0.3, 0.8, 320, 0.8, 'lowpass');
        this.tone(150, 0.35, 0.5, 'sawtooth', 0, 55);
        break;
      case 'denied':
        this.tone(160, 0.18, 0.25, 'square');
        this.tone(120, 0.25, 0.25, 'square', 0.14);
        break;
    }
  }

  /** Quitar o devolver el volumen de todo el juego. */
  setMuted(m: boolean) {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : this.vol, this.ctx.currentTime, 0.02);
  }

  /** El volumen general (0–1) de los ajustes. */
  setVolume(v: number) {
    this.vol = v;
    this.setMuted(this.muted);
  }

  /** Los volúmenes de efectos y ambiente de los ajustes. */
  setMix() {
    this.sfx.gain.value = settings.sfx * 2.6; // (antes todo sonaba muy bajo: el volumen de base sube y el compresor lo contiene)
    this.amb.gain.value = settings.ambient * 2;
  }

  private loop(src: AudioScheduledSourceNode, ...chain: AudioNode[]) {
    let n: AudioNode = src;
    for (const x of chain) n.connect(x), (n = x);
    n.connect(this.amb);
    src.start();
    this.nodes.push(src, ...chain);
  }

  private noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  private started = false;
  /** El fondo: zumbido y siseo, sin parar (una sola vez: de la sala de espera a la partida es el mismo). */
  start() {
    if (this.started) return;
    this.started = true;
    const c = this.ctx;
    if (c.state === 'suspended') c.resume().catch(() => {});
    // el zumbido: 120 Hz y armónicos impares, muy bajito, con un trémolo lento
    const hum = (this.hum = c.createGain());
    hum.gain.value = 0.035;
    for (const [f, g] of [[120, 1], [240, 0.5], [360, 0.35], [600, 0.12]] as const) {
      const o = c.createOscillator(), gg = c.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      gg.gain.value = g;
      o.connect(gg).connect(hum);
      o.start();
      this.nodes.push(o, gg);
    }
    const trem = c.createOscillator(), tg = c.createGain();
    trem.frequency.value = 0.21;
    tg.gain.value = 0.012;
    trem.connect(tg).connect(hum.gain);
    trem.start();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    hum.connect(lp).connect(this.amb);
    this.nodes.push(hum, trem, tg, lp);
    // la ventilación: un rumor grave que no para
    const vlp = c.createBiquadFilter(), vg = c.createGain();
    vlp.type = 'lowpass';
    vlp.frequency.value = 140;
    vg.gain.value = 0.06;
    this.loop(this.noiseSrc(), vlp, vg);
    // la cordura perdida: dos graves casi iguales que baten (sube con ella)
    const mad = (this.mad = c.createGain());
    mad.gain.value = 0;
    for (const f of [55, 57.3]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.connect(mad);
      o.start();
      this.nodes.push(o);
    }
    mad.connect(this.amb);
    this.nodes.push(mad);
    // el aire frío que sube de los huecos: un soplo grave y lento (sube al acercarse a uno, ver pit())
    const pbp = c.createBiquadFilter(), pit = (this.pitGain = c.createGain());
    pbp.type = 'bandpass';
    pbp.frequency.value = 260;
    pbp.Q.value = 0.6;
    pit.gain.value = 0;
    const swell = c.createOscillator(), sg = c.createGain();
    swell.frequency.value = 0.18;
    sg.gain.value = 120;
    swell.connect(sg).connect(pbp.frequency);
    swell.start();
    this.nodes.push(swell, sg);
    this.loop(this.noiseSrc(), pbp, pit);
    // el siseo de la cinta
    const hp = c.createBiquadFilter(), hg = c.createGain();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    hg.gain.value = 0.018;
    this.loop(this.noiseSrc(), hp, hg);
  }

  private burst(dur: number, gain: number, f: number, q = 1, type: BiquadFilterType = 'bandpass', t0 = 0, dest: AudioNode = this.sfx) {
    const c = this.ctx, t = c.currentTime + t0, s = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    bp.type = type;
    bp.frequency.value = f;
    bp.Q.value = q;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bp).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private tone(f: number, dur: number, gain: number, type: OscillatorType = 'square', t0 = 0, f2?: number) {
    const c = this.ctx, t = c.currentTime + t0, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Un paso sobre moqueta: un golpe sordo y un roce; en las salas grandes, con su eco. */
  step(run: boolean, vol = 1, pan = 0) {
    // los de otro jugador: más bajos cuanto más lejos (vol) y hacia su lado (pan, -1 izquierda a 1 derecha)
    let dest: AudioNode = this.sfx;
    if (pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(this.sfx);
      setTimeout(() => p.disconnect(), 600);
      dest = p;
    }
    this.burst(run ? 0.09 : 0.12, (run ? 0.22 : 0.15) * vol, 180, 0.8, 'lowpass', 0, dest);
    this.burst(0.06, 0.04 * vol, 1400, 1.2, 'bandpass', 0, dest);
    if (this.open > 0.55) for (const [t, k] of [[0.11, 0.35], [0.23, 0.15]]) this.burst(0.12, (run ? 0.22 : 0.15) * k * this.open * vol, 220, 0.7, 'lowpass', t, dest);
  }

  /** Poolrooms: un paso por el agua o una brazada (chapoteo suave). */
  wade(run = false) {
    this.burst(0.22, run ? 0.16 : 0.1, 900, 0.7, 'lowpass');
    this.burst(0.12, 0.05, 2600, 1.5, 'bandpass', 0.05);
  }

  /** La alarma de la entrada: una sirena grave que sube y baja, hasta que se apaga. */
  private siren?: { o: OscillatorNode[]; g: GainNode };
  alarm(on: boolean) {
    const c = this.ctx, t = c.currentTime;
    if (!on) {
      const s = this.siren;
      this.siren = undefined;
      if (!s) return;
      s.g.gain.setTargetAtTime(0, t, 0.25);
      setTimeout(() => s.o.forEach((o) => (o.stop(), o.disconnect())), 1500);
      return;
    }
    if (this.siren) return;
    const g = c.createGain(), lp = c.createBiquadFilter(), a = c.createOscillator(), b = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    a.type = 'sawtooth';
    b.type = 'square';
    a.frequency.value = 98;
    b.frequency.value = 49;
    lfo.frequency.value = 0.9; // sube y baja casi cada segundo
    lg.gain.value = 26;
    lfo.connect(lg).connect(a.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.6);
    a.connect(lp);
    b.connect(lp);
    lp.connect(g).connect(this.sfx);
    [a, b, lfo].forEach((o) => o.start());
    this.siren = { o: [a, b, lfo], g };
  }
  /** Un golpe grave (la cerradura, la puerta al llegar al tope). */
  boom() {
    this.burst(0.5, 0.7, 120, 0.7, 'lowpass');
    this.tone(62, 0.9, 0.5, 'sine', 0, 26);
  }
  /** La máquina expendedora: el motor, el golpe de la lata y el eco en la bandeja. */
  vend() {
    this.tone(120, 0.5, 0.05, 'sawtooth', 0, 160);
    this.burst(0.08, 0.5, 300, 1, 'lowpass', 0.55);
    this.burst(0.18, 0.18, 2200, 6, 'bandpass', 0.62);
    this.burst(0.12, 0.12, 2800, 7, 'bandpass', 0.78);
  }

  private mad?: GainNode;
  private muz?: GainNode;
  private muzNext = 0;
  private muzI = 0;
  /**
   * Las Suites: el hilo musical, lejos y apagado (piano eléctrico sobre Cmaj7 · Am7 · Dm7 · G7, algo desafinado). Cada fotograma:
   * cuando toca, un acorde arpegiado; entre acorde y acorde, silencio, y de vez en cuando la campanilla de un ascensor lejano.
   */
  muzak(dt: number) {
    const c = this.ctx;
    if (!this.muz) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1300;
      this.muz = c.createGain();
      this.muz.gain.value = 0.7;
      this.muz.connect(lp).connect(this.amb);
      this.nodes.push(this.muz, lp);
    }
    if ((this.muzNext -= dt) > 0) return;
    this.muzNext = 5 + Math.random() * 3;
    const chords = [[261.6, 329.6, 392, 493.9], [220, 261.6, 329.6, 392], [293.7, 349.2, 440, 523.3], [196, 246.9, 293.7, 349.2]], ch = chords[this.muzI++ % 4], det = 2 ** ((Math.random() * 24 - 12) / 1200);
    [...ch, ch[2] * 2, ch[1] * 2].forEach((f, i) => {
      const t = c.currentTime + i * 0.45 + Math.random() * 0.03;
      for (const [m, g] of [[1, 0.05], [2, 0.014]] as const) {
        const o = c.createOscillator(), e = c.createGain();
        o.frequency.value = f * m * det;
        e.gain.setValueAtTime(0.0001, t);
        e.gain.exponentialRampToValueAtTime(g, t + 0.02);
        e.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        o.connect(e).connect(this.muz!);
        o.start(t);
        o.stop(t + 2.3);
      }
    });
    if (Math.random() < 0.25) this.tone(1320, 0.9, 0.012, 'sine', 3 + Math.random() * 2); // una campanilla de ascensor, lejos
  }

  private open = 0;
  private nextAmb = 10;
  /**
   * Cada fotograma: lo abierta que es la sala (0–1, para el eco), la cordura perdida (0–1) y, de vez
   * en cuando, algo lejos: pasos que no son tuyos, golpes en una pared, un crujido del techo.
   */
  ambient(dt: number, open: number, mad: number) {
    this.open = open;
    this.mad?.gain.setTargetAtTime(0.05 * mad * mad, this.ctx.currentTime, 0.5);
    if ((this.nextAmb -= dt) > 0) return;
    this.nextAmb = 9 + Math.random() * 16;
    const r = Math.random();
    if (r < 0.4) for (let i = 0, n = 3 + ((Math.random() * 4) | 0); i < n; i++) this.burst(0.14, 0.05, 150, 0.7, 'lowpass', i * (0.45 + Math.random() * 0.1));
    else if (r < 0.75) for (let i = 0, n = 2 + ((Math.random() * 2) | 0); i < n; i++) this.burst(0.08, 0.07, 420, 2, 'bandpass', i * 0.32);
    else this.tone(90 + Math.random() * 40, 1.4, 0.02, 'sawtooth', 0, 60);
  }

  /**
   * Cada fotograma, lo cerca que está cada tipo de entidad (metros; Infinity si no hay). La bacteria
   * cruje y chasquea; el partygoer, un matasuegras desafinado y una risita.
   */
  near(kind: 'bacteria' | 'partygoer', d: number) {
    const v = Math.max(0, Math.min(1, 1 - d / 16));
    const now = this.ctx.currentTime;
    if (v < 0.05 || now < this.nearNext[kind]) return;
    if (kind === 'bacteria') {
      for (let i = 0; i < 3 + Math.random() * 4; i++) this.burst(0.03, 0.25 * v, 2500 + Math.random() * 3000, 6, 'bandpass', i * 0.05 + Math.random() * 0.03);
      this.nearNext[kind] = now + 0.4 + Math.random() * 1.2;
    } else {
      const f = 520 + Math.random() * 80;
      this.tone(f, 0.35, 0.05 * v, 'sawtooth', 0, f * 0.82);
      if (Math.random() < 0.4) [0, 0.11, 0.2].forEach((t, i) => this.tone(700 - i * 60, 0.07, 0.03 * v, 'triangle', 0.45 + t));
      this.nearNext[kind] = now + 1.2 + Math.random() * 2;
    }
  }

  shot() {
    this.burst(0.35, 0.9, 900, 0.5, 'lowpass');
    this.tone(90, 0.25, 0.4, 'sine', 0, 40);
  }
  shutter() {
    this.burst(0.03, 0.4, 3000, 2);
    this.burst(0.05, 0.3, 1800, 2, 'bandpass', 0.07);
  }
  private hum?: GainNode;
  private pitGain?: GainNode;
  /** Lo cerca que se está de un hueco (0–1): el aire que sale de él. */
  pit(v: number) {
    this.pitGain?.gain.setTargetAtTime(0.1 * v * v, this.ctx.currentTime, 0.2);
  }
  /** La corriente: el zumbido de los tubos se va con ella. */
  power(v: number) {
    this.hum?.gain.setTargetAtTime(0.035 * v, this.ctx.currentTime, 0.03);
  }
  /** El golpe del diferencial al irse la luz (y al volver, más agudo). */
  clunk(on: boolean) {
    this.burst(0.18, 0.5, on ? 240 : 110, 0.9, 'lowpass');
    this.tone(on ? 70 : 45, 0.3, 0.25, 'sine', 0, on ? 90 : 30);
  }

  /** Una puerta pesada que se abre: un golpe de la cerradura y el chirrido de los goznes. */
  creak() {
    this.burst(0.1, 0.35, 160, 0.8, 'lowpass');
    this.tone(180, 1.3, 0.05, 'sawtooth', 0.1, 310);
    this.tone(187, 1.3, 0.04, 'sawtooth', 0.1, 330);
    this.burst(1.2, 0.05, 900, 3, 'bandpass', 0.15);
  }

  private tvGain?: GainNode;
  /** El siseo de las teles encendidas (misión «TURN OFF THE TVS»): `v` (0–1) es lo cerca que está la más próxima; 0 lo apaga. */
  tvStatic(v: number) {
    if (!this.tvGain) {
      if (v <= 0) return;
      const g = this.ctx.createGain(), bp = this.ctx.createBiquadFilter(), whine = this.ctx.createOscillator(), wg = this.ctx.createGain();
      g.gain.value = 0;
      bp.type = 'bandpass';
      bp.frequency.value = 3400;
      bp.Q.value = 0.5;
      whine.frequency.value = 15700; // el pitido agudo del tubo
      wg.gain.value = 0.01;
      whine.connect(wg).connect(g);
      whine.start();
      this.nodes.push(whine, wg);
      this.loop(this.noiseSrc(), bp, g);
      this.tvGain = g;
    }
    this.tvGain.gain.setTargetAtTime(0.16 * v * v, this.ctx.currentTime, 0.12);
  }
  /** Una tele que se apaga: el golpe seco del interruptor y el pitido que se cae. */
  tvOff() {
    this.burst(0.05, 0.35, 700, 1.5, 'lowpass');
    this.tone(2400, 0.35, 0.05, 'sine', 0.03, 120);
  }

  /** El interruptor de la linterna. */
  click() {
    this.burst(0.012, 0.3, 4200, 4, 'bandpass');
    this.burst(0.015, 0.2, 2600, 4, 'bandpass', 0.06);
  }
  /** Recoger algo; con rareza (1–4) suena además un campanilleo de tantas notas como rareza. */
  pickup(rarity = 0) {
    this.burst(0.08, 0.15, 600, 1.5);
    this.tone(880, 0.06, 0.03, 'square', 0.05);
    for (let i = 0; i < rarity; i++) this.tone(1046 * 1.25 ** i, 0.5, 0.1, 'sine', 0.1 + i * 0.08);
  }
  /** Un trozo del chorro de la pistola de agua (se llama a ~8 Hz mientras se dispara) y el glu-glu de la recarga. */
  squirt() {
    this.burst(0.14, 0.09, 2600, 0.9, 'bandpass');
  }
  refill() {
    this.burst(0.2, 0.1, 500, 3, 'bandpass');
  }
  /** Un trago de la lata: dos glup. */
  drink() {
    this.burst(0.1, 0.12, 320, 2);
    setTimeout(() => this.burst(0.12, 0.12, 260, 2), 170);
  }
  reject() {
    this.tone(110, 0.4, 0.08, 'square');
  }
  private beatT = 0;
  private breathT = 0;
  /** Escondido, cada fotograma: el latido y la respiración. `fear` 0–1 (sube con una inspección); `held`: contiene el aire (solo el corazón). */
  hideAmb(dt: number, fear: number, held: boolean) {
    this.beatT -= dt;
    this.breathT -= dt;
    if (this.beatT <= 0) {
      this.beatT = 1.05 - 0.5 * fear;
      const g = 0.22 + 0.25 * fear;
      this.tone(52, 0.16, g, 'sine', 0, 38);
      this.tone(46, 0.2, g * 0.8, 'sine', 0.2, 34);
    }
    if (!held && this.breathT <= 0) {
      this.breathT = 2.2 - fear * 0.9;
      this.burst(0.7, 0.07 + 0.06 * fear, 900, 0.6, 'bandpass');
    }
  }
  /** Se queda sin aire: un jadeo. */
  gasp() {
    this.burst(0.5, 0.35, 1300, 0.7, 'bandpass');
    this.burst(0.4, 0.2, 700, 0.8, 'bandpass', 0.35);
  }
  reload() {
    this.burst(0.05, 0.35, 2200, 3);
    this.burst(0.06, 0.4, 1200, 3, 'bandpass', 0.35);
  }
  /** Misión cumplida (el ascensor se abre): dos notas que suben. */
  done() {
    [0, 0.18, 0.36].forEach((t, i) => this.tone([660, 880, 1320][i], 0.4, 0.07, 'sine', t));
  }
  elevator() {
    [0, 0.45].forEach((t) => this.tone(1320, 0.5, 0.06, 'sine', t));
    this.burst(2, 0.12, 300, 0.7, 'lowpass', 0.6);
  }

  /** La cinta se come: 0 nada, 1 todo roto (distorsión que sube y cortes). */
  corrupt(f: number) {
    const n = 1024, curve = new Float32Array(n), k = f * 80;
    for (let i = 0; i < n; i++) {
      const x = (i / n) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    this.shaper.curve = f > 0 ? curve : null;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(f > 0.2 && Math.random() < f * 0.5 ? 0 : 0.8 * (1 - f * 0.3), t);
    if (f >= 1) this.out.gain.setTargetAtTime(0, t, 0.3);
  }

  dispose() {
    document.removeEventListener('click', this.onClick, true);
    if (live === this) live = undefined;
    for (const n of this.nodes) {
      try {
        (n as AudioScheduledSourceNode).stop?.();
      } catch {}
      n.disconnect();
    }
    this.out.disconnect();
    this.master.disconnect();
    this.ctx.close().catch(() => {});
  }
}
