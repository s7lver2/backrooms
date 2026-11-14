import { useSyncExternalStore } from 'react';
import { settings } from './settings';
import type { Sock } from './net';

/*
 * Chat de voz de la sala: WebRTC entre jugadores (malla: cada uno con cada uno; vale para 4). El servidor solo reenvía la señalización
 * (`rtc`), el audio no pasa por él. Cada pareja abre UNA conexión con un transceptor de audio desde el principio: el micrófono se
 * engancha después con replaceTrack, sin renegociar. Inicia la oferta el de id menor (así no se cruzan).
 * Modos (ajuste voiceMode): 0 apagado, 1 pulsar para hablar (V), 2 micrófono abierto. Con el modo 1 el micrófono se pide al primer V.
 * Servidores: STUN de Google; para redes que no dejan pasar P2P, VITE_ICE_SERVERS (JSON de RTCIceServer[], p. ej. un TURN).
 */

const PTT = 'KeyV';
const ICE: RTCIceServer[] = (() => {
  try {
    const v = JSON.parse(import.meta.env.VITE_ICE_SERVERS || 'null');
    if (Array.isArray(v)) return v;
  } catch {}
  return [{ urls: 'stun:stun.l.google.com:19302' }];
})();

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pending: RTCIceCandidateInit[];
  level?: () => number;
  src?: MediaStreamAudioSourceNode;
  /** Su tramo propio: volumen, filtro y balance según dónde esté respecto a ti (ver `listen`). */
  gain?: GainNode;
  lp?: BiquadFilterNode;
  pan?: StereoPannerNode;
}

/** La voz según la distancia (m): entera hasta NEAR, nada a FAR; más lejos, también más apagada. */
const NEAR = 3, FAR = 24;
/** El volumen máximo de las voces (×3 = 300 %): el limitador del final evita que sature. */
export const VOL_MAX = 3;

/** El sonido de la voz según dónde se esté: filtro de paso bajo, cantidad de eco (wet) y lo que dura. */
const ENV: Record<string, { lp: number; wet: number; decay: number }> = {
  wait: { lp: 16000, wet: 0.04, decay: 0.4 },
  maze: { lp: 7500, wet: 0.3, decay: 1.1 }, // pasillos de moqueta y ladrillo: apagada y con cola
  pool: { lp: 12000, wet: 0.5, decay: 2.4 }, // azulejo: brillante y con mucho eco
};
/** Opus para voz: 64 kb/s mono (el de serie ronda 32), corrección de pérdidas en banda (FEC) y banda completa a 48 kHz. */
const opus = (sdp = '') => {
  const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  const strip = /;?(maxaveragebitrate|stereo|sprop-stereo|useinbandfec|cbr|maxplaybackrate)=[^;\r\n]*/g;
  return sdp.replace(new RegExp(`a=fmtp:${pt} ([^\r\n]*)`), (_, f: string) => `a=fmtp:${pt} ${f.replace(strip, '')};maxaveragebitrate=64000;useinbandfec=1;stereo=0;sprop-stereo=0;cbr=0;maxplaybackrate=48000`);
};
type Sig = { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };

class Voice {
  private sock?: Sock;
  private me = '';
  private peers = new Map<string, Peer>();
  private mic?: MediaStream;
  private micAsk?: Promise<void>;
  private ctx?: AudioContext;
  private micLevel?: () => number;
  private held = false;
  private tickId?: ReturnType<typeof setInterval>;
  private ver = 0;
  private bus?: { inp: GainNode; lp: BiquadFilterNode; conv: ConvolverNode; wet: GainNode };
  private envKind = 'wait';
  private subs = new Set<() => void>();
  /** Quién suena ahora (ids de socket; el mío incluido). */
  speaking = new Set<string>();
  /** Estado del micrófono: sin pedir, en marcha o denegado/ausente. */
  state: 'idle' | 'on' | 'denied' = 'idle';
  /** Por qué no hay micrófono: sin HTTPS el navegador ni lo ofrece (solo en localhost o https). */
  why = '';
  /** Conexiones de voz establecidas y las que debería haber. */
  linked = () => [[...this.peers.values()].filter((p) => p.pc.connectionState === 'connected').length, this.peers.size];
  /** Estoy emitiendo (tecla pulsada o micro abierto). */
  talking = false;

  private bump() {
    this.ver++;
    this.subs.forEach((f) => f());
  }
  subscribe = (f: () => void) => (this.subs.add(f), () => void this.subs.delete(f));
  snapshot = () => this.ver;

  /** Engancharse al socket de la sala. */
  attach(sock: Sock) {
    this.detach();
    this.sock = sock;
    sock.on('rtc', this.onSignal);
    addEventListener('keydown', this.key);
    addEventListener('keyup', this.key);
    addEventListener('blur', this.release);
    this.tickId = setInterval(this.tick, 100);
  }

  detach() {
    this.sock?.off('rtc', this.onSignal);
    this.sock = undefined;
    removeEventListener('keydown', this.key);
    removeEventListener('keyup', this.key);
    removeEventListener('blur', this.release);
    clearInterval(this.tickId);
    [...this.peers.keys()].forEach((id) => this.drop(id));
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = this.micAsk = this.micLevel = undefined;
    this.bus = undefined;
    this.ctx?.close().catch(() => {});
    this.ctx = undefined;
    this.held = this.talking = false;
    this.state = 'idle';
    this.speaking = new Set();
    this.bump();
  }

  /** El entorno que suena en la voz de los demás: 'wait' (sala de espera), 'maze' o 'pool'. */
  env(kind: string) {
    this.envKind = ENV[kind] ? kind : 'maze';
    if (this.bus) this.tune();
  }
  private tune() {
    const b = this.bus!, e = ENV[this.envKind], c = this.ctx!, n = Math.floor(c.sampleRate * e.decay), buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2.5;
    }
    b.conv.buffer = buf;
    b.lp.frequency.value = e.lp;
    b.wet.gain.value = e.wet;
  }
  /** La cadena común de la voz recibida: volumen → filtro → (seco + eco) → altavoces. */
  private chain() {
    const c = (this.ctx ??= new AudioContext());
    if (!this.bus) {
      const inp = c.createGain(), lp = c.createBiquadFilter(), conv = c.createConvolver(), wet = c.createGain(), dry = c.createGain(), lim = c.createDynamicsCompressor();
      lp.type = 'lowpass';
      // limitador al final: con el volumen por encima de 100 % la voz sube sin saturar ni romper
      lim.threshold.value = -8;
      lim.knee.value = 6;
      lim.ratio.value = 14;
      lim.attack.value = 0.003;
      lim.release.value = 0.2;
      lim.connect(c.destination);
      inp.connect(lp);
      lp.connect(dry).connect(lim);
      lp.connect(conv).connect(wet).connect(lim);
      this.bus = { inp, lp, conv, wet };
      this.tune();
    }
    if (c.state === 'suspended') void c.resume();
    return this.bus;
  }

  /** Con quién hay una llamada de Nokia: se oyen como si estuvieran al lado, estén donde estén. */
  calls = new Set<string>();
  private ears?: { t: number; m: Map<string, { d: number; pan: number }> };
  /** El juego dice, cada fotograma, a qué distancia (m) y hacia qué lado (−1 izquierda, 1 derecha) está cada compañero. */
  listen(m: Map<string, { d: number; pan: number }>) {
    this.ears = { t: performance.now(), m };
  }

  /** Los jugadores de la sala ahora: se abren las conexiones que faltan y se cierran las de quien se fue. */
  sync(me: string, ids: string[]) {
    if (!this.sock) return;
    this.me = me;
    const want = new Set(ids.filter((i) => i !== me));
    for (const id of want) if (!this.peers.has(id)) this.open(id);
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.drop(id);
  }

  private open(id: string) {
    const pc = new RTCPeerConnection({ iceServers: ICE }), audio = new Audio();
    audio.autoplay = true;
    const p: Peer = { pc, audio, pending: [] };
    this.peers.set(id, p);
    if (this.me < id) {
      // solo quien ofrece crea el transceptor: el que responde usa el que trae la oferta (uno creado antes con addTransceiver no se asocia a ella y su micrófono no sonaba: voz en un solo sentido)
      const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (this.mic) void tr.sender.replaceTrack(this.mic.getAudioTracks()[0] ?? null);
    }
    pc.onicecandidate = (e) => e.candidate && this.send(id, { ice: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      const ms = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = ms;
      audio.muted = true; // (se oye por la cadena de Web Audio; el elemento solo mantiene vivo el flujo)
      void audio.play().catch(() => {});
      p.src?.disconnect();
      {
        const b = this.chain(), c = this.ctx!;
        p.src = c.createMediaStreamSource(ms);
        p.gain ??= c.createGain();
        if (!p.lp) (p.lp = c.createBiquadFilter()), (p.lp.type = 'lowpass'), (p.lp.frequency.value = 16000);
        p.pan ??= c.createStereoPanner();
        p.gain.disconnect(), p.lp.disconnect(), p.pan.disconnect();
        p.src.connect(p.gain).connect(p.lp).connect(p.pan).connect(b.inp);
      }
      p.level = this.meter(ms);
    };
    pc.onconnectionstatechange = () => (this.bump(), pc.connectionState === 'failed') && this.peers.get(id) === p && (this.drop(id), this.sock && this.open(id));
    if (this.me < id) {
      void (async () => {
        try {
          const o = await pc.createOffer();
          await pc.setLocalDescription({ type: 'offer', sdp: opus(o.sdp) });
          this.send(id, { sdp: pc.localDescription!.toJSON() });
        } catch {}
      })();
    }
    return p;
  }

  private drop(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.pc.close();
    p.audio.srcObject = null;
    p.src?.disconnect(), p.gain?.disconnect(), p.lp?.disconnect(), p.pan?.disconnect();
    this.speaking.delete(id);
  }

  private send(to: string, data: Sig) {
    this.sock?.emit('rtc', to, data);
  }

  private onSignal = async (from: string, data: unknown) => {
    const d = data as Sig;
    const p = this.peers.get(from) ?? this.open(from);
    try {
      if (d.sdp) {
        await p.pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === 'offer') {
          const tr = p.pc.getTransceivers()[0];
          if (tr) (tr.direction = 'sendrecv'), void tr.sender.replaceTrack(this.mic?.getAudioTracks()[0] ?? null);
          const a = await p.pc.createAnswer();
          await p.pc.setLocalDescription({ type: 'answer', sdp: opus(a.sdp) });
          this.send(from, { sdp: p.pc.localDescription!.toJSON() });
        }
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
      } else if (d.ice) {
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(d.ice).catch(() => {});
        else p.pending.push(d.ice);
      }
    } catch {}
  };

  /** Un medidor del nivel (0–1) de un flujo, para saber quién habla. */
  private meter(stream: MediaStream) {
    const c = (this.ctx ??= new AudioContext());
    if (c.state === 'suspended') void c.resume();
    const an = c.createAnalyser();
    an.fftSize = 512;
    c.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    return () => {
      an.getByteTimeDomainData(buf);
      let m = 0;
      for (const v of buf) m = Math.max(m, Math.abs(v - 128));
      return m / 128;
    };
  }

  private async ensureMic() {
    if (this.mic || this.state === 'denied') return;
    this.micAsk ??= (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: { ideal: 48000 } }, video: false });
        this.mic = s;
        const t = s.getAudioTracks()[0];
        t.enabled = false;
        for (const p of this.peers.values()) void p.pc.getSenders().find((x) => !x.track || x.track.kind === 'audio')?.replaceTrack(t);
        this.micLevel = this.meter(s);
        this.state = 'on';
      } catch {
        this.state = 'denied';
        this.why = navigator.mediaDevices ? 'MIC BLOCKED' : 'MIC NEEDS HTTPS';
      }
      this.bump();
    })();
    await this.micAsk;
  }

  private key = (e: KeyboardEvent) => {
    if (e.code !== PTT || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    this.held = e.type === 'keydown';
  };
  private release = () => (this.held = false);

  private tick = () => {
    const mode = settings.voiceMode, want = mode === 2 || (mode === 1 && this.held);
    if (want && !this.mic) void this.ensureMic();
    const on = want && !!this.mic;
    const track = this.mic?.getAudioTracks()[0];
    if (track && track.enabled !== on) track.enabled = on;
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {}); // (creado sin gesto, el contexto nace parado: sin esto las voces no sonaban hasta recrearse)
    const vol = settings.voiceMode ? settings.voiceVol : 0;
    if (this.bus) this.bus.inp.gain.value = Math.max(0, Math.min(VOL_MAX, vol));
    // la distancia: volumen, filtro y balance de cada voz (la pone el juego cada fotograma; sin datos —sala de espera—, se oyen todos igual)
    const live = this.ears && performance.now() - this.ears.t < 600 ? this.ears.m : undefined, now = this.ctx?.currentTime ?? 0;
    for (const [id, p] of this.peers) {
      if (!p.gain || !p.lp || !p.pan) continue;
      const e = this.calls.has(id) ? undefined : live?.get(id), k = e ? Math.max(0, Math.min(1, 1 - (e.d - NEAR) / (FAR - NEAR))) ** 1.6 : 1;
      p.gain.gain.setTargetAtTime(k, now, 0.08);
      p.lp.frequency.setTargetAtTime(900 + 15100 * k ** 0.7, now, 0.08);
      p.pan.pan.setTargetAtTime(e ? Math.max(-0.85, Math.min(0.85, e.pan)) * Math.min(1, e.d / 2) : 0, now, 0.08);
    }
    const next = new Set<string>();
    for (const [id, p] of this.peers) if ((p.level?.() ?? 0) > 0.04) next.add(id);
    if (on && (this.micLevel?.() ?? 0) > 0.04) next.add(this.me);
    const changed = on !== this.talking || next.size !== this.speaking.size || [...next].some((i) => !this.speaking.has(i));
    this.talking = on;
    this.speaking = next;
    if (changed) this.bump();
  };
}

export const voice = new Voice();

/** Para pintar el estado de la voz: se refresca al cambiar quién habla o el micrófono. */
export function useVoice() {
  useSyncExternalStore(voice.subscribe, voice.snapshot);
  return voice;
}
