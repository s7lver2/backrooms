import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type { ReplayClock } from './clock';

/*
 * Exportar un fragmento de la repeticion como video o GIF. Se graba EN TIEMPO REAL mientras el reloj recorre el tramo (el juego
 * interpola con el reloj de pared, asi que avanzarlo a saltos lo descompondria): la imagen es la del propio lienzo del juego,
 * sin la interfaz del visor. El video no lleva audio.
 */
export const MAX_VIDEO_MS = 30000;
export const MAX_GIF_MS = 10000;

export type ExportOpt = {
  canvas: HTMLCanvasElement;
  clock: ReplayClock;
  from: number;
  to: number;
  onProgress: (f: number) => void;
  signal: AbortSignal;
};

/** Pone el reloj en `from` y lo deja correr hasta `to`; `each` se llama en cada fotograma del navegador. */
function run(o: ExportOpt, max: number, each?: (t: number) => void): Promise<void> {
  const to = Math.min(o.to, o.from + max);
  o.clock.seek(o.from);
  o.clock.speed = 1;
  o.clock.playing = true;
  return new Promise((ok) => {
    const f = () => {
      const t = o.clock.t;
      each?.(t);
      o.onProgress(Math.min(1, (t - o.from) / Math.max(1, to - o.from)));
      if (o.signal.aborted || t >= to || !o.clock.playing) return ok();
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
}

export async function exportVideo(o: ExportOpt): Promise<Blob | null> {
  const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('no video recording support');
  const rec = new MediaRecorder(o.canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise<void>((ok) => (rec.onstop = () => ok()));
  rec.start(250);
  await run(o, MAX_VIDEO_MS);
  rec.stop();
  await stopped;
  return o.signal.aborted ? null : new Blob(parts, { type: mime.split(';')[0] });
}

export async function exportGif(o: ExportOpt): Promise<Blob | null> {
  const FPS = 12, W = 480, H = Math.max(2, Math.round((o.canvas.height / o.canvas.width) * W));
  // el lienzo del juego (WebGPU) no se lee a pelo con fiabilidad: se pasa por un <video> de su flujo
  const v = document.createElement('video');
  v.muted = true;
  v.srcObject = o.canvas.captureStream(FPS);
  await v.play();
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const gif = GIFEncoder();
  let last = -1e9;
  await run(o, MAX_GIF_MS, (t) => {
    if (t - last < 1000 / FPS) return;
    last = t;
    ctx.drawImage(v, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    const pal = quantize(data, 256);
    gif.writeFrame(applyPalette(data, pal), W, H, { palette: pal, delay: Math.round(1000 / FPS) });
  });
  v.pause();
  v.srcObject = null;
  if (o.signal.aborted) return null;
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}
