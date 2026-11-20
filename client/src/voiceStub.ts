/*
 * Sustituto de phoenyx-voice cuando no esta el repo del motor al compilar: micro sin puerta ni modulacion (mismo API que paquete).
 */
export type MicState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unavailable';
export interface MicDevice {
  id: string;
  label: string;
}
export type FxPreset = 'none';
export const FX_PRESETS: readonly string[] = ['none'];
export class Mic {
  state: MicState = 'unknown';
  devices: MicDevice[] = [];
  onChange = (_f: () => void) => () => {};
  async query(): Promise<MicState> {
    return (this.state = navigator.mediaDevices ? 'prompt' : 'unavailable');
  }
  async refresh(): Promise<MicDevice[]> {
    try {
      this.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `MICROPHONE ${i + 1}` }));
    } catch {
      this.devices = [];
    }
    return this.devices;
  }
  async request(deviceId?: string): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) throw ((this.state = 'unavailable'), new Error('MIC NEEDS HTTPS'));
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
      this.state = 'granted';
      return s;
    } catch (e) {
      this.state = 'denied';
      throw e;
    }
  }
}
export interface Capture {
  stream: MediaStream;
  track: MediaStreamTrack;
  level(): number;
  open(): boolean;
  set(o: unknown): void;
  dispose(): void;
}
export async function createCapture(ctx: AudioContext, raw: MediaStream, o: { gain: number }): Promise<Capture> {
  const src = ctx.createMediaStreamSource(raw), gain = ctx.createGain(), an = ctx.createAnalyser(), dest = ctx.createMediaStreamDestination(), buf = new Uint8Array(512);
  an.fftSize = 512;
  gain.gain.value = o.gain;
  src.connect(gain).connect(an);
  gain.connect(dest);
  return {
    stream: dest.stream,
    track: dest.stream.getAudioTracks()[0],
    level: () => (an.getByteTimeDomainData(buf), Math.max(...buf.map((v) => Math.abs(v - 128))) / 128),
    open: () => true,
    set: (n) => void ((n as { gain?: number }).gain !== undefined && (gain.gain.value = (n as { gain: number }).gain)),
    dispose: () => (raw.getTracks().forEach((t) => t.stop()), [src, gain, an, dest].forEach((n) => n.disconnect())),
  };
}
