import { useSyncExternalStore } from 'react';
import { settings } from './settings';
import type { Sock } from './net';
import { E2ee, FX_PRESETS, Mesh, Mic, Spatial, createCapture, type Capture, type SpatialQuality, type Vec3, type VoiceWorld } from '@phoenyx/voice';

/** El micrófono (permiso y dispositivos): lo usa también SETTINGS para configurarlo desde el juego. */
export const voiceMic = new Mic();

/*
 * Chat de voz de la sala, sobre la librería del motor (phoenyx-voice): transporte en malla (Mesh), captura con puerta y modulación (Capture) y sonido en el
 * espacio (Spatial: distancia, HRTF, paredes y reverb según la sala). El servidor solo reenvía la señalización (`rtc`): el audio no pasa por él.
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
  audio: HTMLAudioElement;
  src: MediaStreamAudioSourceNode;
  level: () => number;
}

/** El volumen máximo de las voces (×3 = 300 %): el limitador del final evita que sature. */
export const VOL_MAX = 3;
/** El perfil del sonido 3D (ajuste VOICE 3D): posición en la lista = SpatialQuality. */
export const VOICE_3D: readonly SpatialQuality[] = ['off', 'low', 'medium', 'high'];

/** El sonido de la voz según dónde se esté (sin medida de la sala): brillo del eco, cantidad (wet) y lo que dura. */
const ENV: Record<string, { lp: number; wet: number; decay: number }> = {
  wait: { lp: 16000, wet: 0.04, decay: 0.4 },
  maze: { lp: 7500, wet: 0.3, decay: 1.1 }, // pasillos de moqueta y ladrillo: apagada y con cola
  pool: { lp: 12000, wet: 0.5, decay: 2.4 }, // azulejo: brillante y con mucho eco
};

/** Dónde está alguien (m) para el sonido 3D. */
export interface VoicePos {
  pos: Vec3;
  /** Sin sitio en el mapa (un muerto que espectea): se oye entero y centrado, para poder hablarle. */
  free?: boolean;
}

class Voice {
  private sock?: Sock;
  private mesh?: Mesh;
  private me = '';
  private peers = new Map<string, Peer>();
  private mic?: MediaStream;
  private micAsk?: Promise<void>;
  private cap?: Capture;
  private capKey = '';
  private devKey = '';
  private testing = false;
  private mon?: { src: MediaStreamAudioSourceNode; gain: GainNode };
  private ctx?: AudioContext;
  private micLevel?: () => number;
  private held = false;
  private tickId?: ReturnType<typeof setInterval>;
  private ver = 0;
  private bus?: { inp: GainNode; spatial: Spatial };
  private envKind = 'wait';
  private subs = new Set<() => void>();
  private view?: { t: number; me: { pos: Vec3; yaw: number }; others: Map<string, VoicePos> };
  /** Quién suena ahora (ids de socket; el mío incluido). */
  speaking = new Set<string>();
  /** Estado del micrófono: sin pedir, en marcha o denegado/ausente. */
  state: 'idle' | 'on' | 'denied' = 'idle';
  /** Por qué no hay micrófono: sin HTTPS el navegador ni lo ofrece (solo en localhost o https). */
  why = '';
  /** Conexiones de voz establecidas y las que debería haber. */
  linked = (): [number, number] => this.mesh?.linked() ?? [0, 0];
  /** Conexiones cifradas de extremo a extremo y las que hay. */
  secure = (): [number, number] => this.mesh?.secure() ?? [0, 0];
  /** El código de seguridad con ese jugador (si coincide en los dos lados, nadie se ha puesto en medio). */
  safety = (id: string) => this.mesh?.safetyCode(id);
  /** Estoy emitiendo (tecla pulsada o micro abierto). */
  talking = false;
  /** Con quién hay una llamada de Nokia: se oyen como si estuvieran al lado, estén donde estén. */
  calls = new Set<string>();

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
    const mesh = (this.mesh = new Mesh(
      { send: (to, data) => sock.emit('rtc', to, data), on: (cb) => (sock.on('rtc', cb), () => void sock.off('rtc', cb)) },
      { iceServers: ICE, e2ee: settings.voiceLock > 0 && E2ee.supported ? new E2ee() : undefined, e2eeMode: settings.voiceLock === 2 ? 'required' : 'optional' },
    ));
    if (this.mic) mesh.setTrack(this.mic.getAudioTracks()[0] ?? null);
    mesh.onTrack = (id, ms) => this.hear(id, ms);
    mesh.onDrop = (id) => this.forget(id);
    mesh.onState = () => this.bump();
    addEventListener('keydown', this.key);
    addEventListener('keyup', this.key);
    addEventListener('blur', this.release);
    this.tickId = setInterval(this.tick, 50);
  }

  detach() {
    this.sock = undefined;
    removeEventListener('keydown', this.key);
    removeEventListener('keyup', this.key);
    removeEventListener('blur', this.release);
    clearInterval(this.tickId);
    this.mesh?.close();
    this.mesh = undefined;
    [...this.peers.keys()].forEach((id) => this.forget(id));
    this.cap?.dispose();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.cap = this.mic = this.micAsk = this.micLevel = undefined;
    this.bus?.spatial.dispose();
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
    this.bus?.spatial.configure({ reverb: ENV[this.envKind] });
  }

  /** El mundo contra el que la voz mide paredes y salas (lo pone el juego al cargar un nivel; sin él, solo distancia). */
  setWorld(w: VoiceWorld | undefined) {
    this.world = w;
    if (this.bus) this.bus.spatial.world = w;
  }
  private world?: VoiceWorld;

  /** El juego dice, cada fotograma, dónde estoy y dónde está cada compañero (sin entrada = se oye entero y centrado). */
  pose(me: { pos: Vec3; yaw: number }, others: Map<string, VoicePos>) {
    this.view = { t: performance.now(), me, others };
  }

  /** La cadena común: voces -> Spatial -> volumen -> limitador -> altavoces. */
  private chain() {
    const c = (this.ctx ??= new AudioContext());
    if (!this.bus) {
      const inp = c.createGain(),
        lim = c.createDynamicsCompressor();
      // limitador al final: con el volumen por encima de 100 % la voz sube sin saturar ni romper
      lim.threshold.value = -8;
      lim.knee.value = 6;
      lim.ratio.value = 14;
      lim.attack.value = 0.003;
      lim.release.value = 0.2;
      inp.connect(lim).connect(c.destination);
      const spatial = new Spatial(c, inp, { quality: VOICE_3D[settings.voice3d] ?? 'high', reverb: ENV[this.envKind] });
      spatial.world = this.world;
      this.bus = { inp, spatial };
    }
    if (c.state === 'suspended') void c.resume();
    return this.bus;
  }

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

  private hear(id: string, ms: MediaStream) {
    this.forget(id);
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = ms;
    audio.muted = true; // (se oye por la cadena de Web Audio; el elemento solo mantiene vivo el flujo)
    void audio.play().catch(() => {});
    const b = this.chain(), src = this.ctx!.createMediaStreamSource(ms);
    b.spatial.addEmitter(id, src);
    this.peers.set(id, { audio, src, level: this.meter(ms) });
  }
  private forget(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.audio.srcObject = null;
    this.bus?.spatial.removeEmitter(id);
    p.src.disconnect();
    this.speaking.delete(id);
  }

  /** Los jugadores de la sala ahora: se abren las conexiones que faltan y se cierran las de quien se fue. */
  sync(me: string, ids: string[]) {
    if (!this.sock) return;
    this.me = me;
    this.mesh?.sync(me, ids);
  }

  /** Lo que se le pide a la captura según los ajustes (ganancia, puerta y modulación). */
  private capOpts() {
    return { gain: settings.micGain, gate: settings.micGate, fx: { preset: FX_PRESETS[settings.micFx] ?? 'none' } };
  }
  private devId = () => voiceMic.devices[settings.micDev - 1]?.id;

  private async ensureMic() {
    if (this.mic || this.state === 'denied') return;
    this.micAsk ??= (async () => {
      try {
        const raw = await voiceMic.request(this.devId());
        const c = (this.ctx ??= new AudioContext());
        if (c.state === 'suspended') void c.resume();
        this.cap = await createCapture(c, raw, this.capOpts());
        this.capKey = JSON.stringify(this.capOpts());
        this.devKey = String(settings.micDev);
        this.mic = this.cap.stream;
        const t = this.cap.track;
        t.enabled = this.testing;
        this.mesh?.setTrack(t);
        this.micLevel = this.cap.level;
        this.state = 'on';
      } catch {
        const denied = voiceMic.state === 'denied' || voiceMic.state === 'unavailable';
        this.state = denied ? 'denied' : 'idle';
        this.why = voiceMic.state === 'unavailable' ? 'MIC NEEDS HTTPS' : denied ? 'MIC BLOCKED' : 'MIC NOT FOUND';
        if (!denied) this.micAsk = undefined; // (otro dispositivo o reintentar)
      }
      this.bump();
    })();
    await this.micAsk;
  }

  /** Suelta el micrófono (para cambiar de dispositivo o al acabar una prueba sin sala): el aviso rojo del navegador se apaga. */
  private freeMic() {
    this.cap?.dispose();
    this.cap = this.mic = this.micLevel = this.micAsk = undefined;
    this.mesh?.setTrack(null);
    this.state = this.state === 'denied' ? 'denied' : 'idle';
    this.bump();
  }

  /** Pedir el permiso desde el juego (un botón de ajustes): el navegador pregunta aquí y, concedido, ya queda configurado dentro del juego. */
  async allowMic() {
    this.state = this.state === 'denied' ? 'idle' : this.state;
    await this.ensureMic();
    if (!this.sock && !this.testing) this.freeMic();
    await voiceMic.refresh();
  }

  /** Prueba de micrófono en ajustes: medidor en vivo y, con `hear`, tu voz ya procesada por los altavoces. */
  async test(on: boolean, hear = false) {
    this.testing = on;
    if (on) await this.ensureMic();
    const t = this.cap?.track;
    if (t) t.enabled = on || (settings.voiceMode === 2 && !!this.sock);
    if (this.mon) (this.mon.src.disconnect(), this.mon.gain.disconnect(), (this.mon = undefined));
    if (on && hear && this.cap && this.ctx) {
      const src = this.ctx.createMediaStreamSource(this.cap.stream), gain = this.ctx.createGain();
      gain.gain.value = 0.8;
      src.connect(gain).connect(this.ctx.destination);
      this.mon = { src, gain };
    }
    if (!on && !this.sock) this.freeMic();
  }
  /** Nivel actual de la entrada (0–1) y si la puerta de ruido deja pasar la voz. */
  micMeter = () => ({ level: this.cap?.level() ?? 0, open: this.cap?.open() ?? false });

  private key = (e: KeyboardEvent) => {
    if (e.code !== PTT || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    this.held = e.type === 'keydown';
  };
  private release = () => (this.held = false);

  private tick = () => {
    // ajustes de micrófono en vivo: otro dispositivo rehace la captura, lo demás solo se afina
    if (this.cap) {
      if (String(settings.micDev) !== this.devKey) (this.freeMic(), void this.ensureMic());
      else {
        const k = JSON.stringify(this.capOpts());
        if (k !== this.capKey) (this.cap.set(this.capOpts()), (this.capKey = k));
      }
    }
    const mode = settings.voiceMode, want = mode === 2 || (mode === 1 && this.held);
    if (want && !this.mic) void this.ensureMic();
    const on = want && !!this.mic;
    const track = this.mic?.getAudioTracks()[0];
    if (track && track.enabled !== on && !this.testing) track.enabled = on;
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {}); // (creado sin gesto, el contexto nace parado: sin esto las voces no sonaban hasta recrearse)
    const vol = settings.voiceMode ? settings.voiceVol : 0;
    if (this.bus) {
      this.bus.inp.gain.value = Math.max(0, Math.min(VOL_MAX, vol));
      // el sonido 3D: perfil, dónde estoy y dónde está cada voz (lo pone el juego cada fotograma; sin datos —sala de espera—, se oyen todos igual)
      const sp = this.bus.spatial, q = VOICE_3D[settings.voice3d] ?? 'high';
      if (sp.cfg.quality !== q) sp.configure({ quality: q });
      const v = this.view && performance.now() - this.view.t < 600 ? this.view : undefined;
      if (v) {
        const y = v.me.yaw;
        sp.setListener(v.me.pos, [-Math.sin(y), 0, -Math.cos(y)]);
      }
      for (const id of this.peers.keys()) {
        const o = v?.others.get(id);
        sp.setEmitter(id, o?.pos, { near: this.calls.has(id), free: !v || !o || o.free });
      }
      sp.update();
    }
    const next = new Set<string>();
    for (const [id, p] of this.peers) if (p.level() > 0.04) next.add(id);
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
