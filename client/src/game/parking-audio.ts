import { GameAudio } from './audio';
import { settings } from '../settings';
import type { ParkingPoint } from '@backrooms/shared';
import type { SkinAgent } from './parking-skinwalker-ai';
import type { Smiler, SmilerState } from './parking-smiler-ai';

type Noise = [seconds: number, gain: number, hz: number, q?: number, delay?: number];
type Tone = [hz: number, seconds: number, gain: number, wave: OscillatorType, endHz?: number, delay?: number];
const cues = {
  walk: { noise: [[.08,.16,235,.8],[.055,.08,1670,1.2]] },
  sprint: { noise: [[.1,.22,205,.8],[.07,.12,1290,1.1]] },
  stairs: { noise: [[.12,.2,300,.9],[.1,.06,660,2,.095]] },
  ramp: { noise: [[.09,.17,250,.9],[.15,.1,980,1.1]] },
  splash: { noise: [[.17,.12,1180,.8],[.11,.07,3100,1.4,.045]] },
  drip: { noise: [[.045,.05,2000,2]], tone: [[970,.1,.034,'sine',500]] },
  pipe: { tone: [[438,.33,.075,'sine',427],[1190,.14,.035,'sine',1140]] },
  metal: { noise: [[.54,.12,460,2],[.24,.075,1060,3,.29]], tone: [[145,.42,.045,'triangle',105,.06]] },
  flashlight: { noise: [[.024,.2,3000,2.5],[.025,.1,1500,1.8,.032]] },
  roomDoor: { noise: [[.16,.15,310,1.1],[.34,.08,780,3,.06]], tone: [[173,.38,.034,'triangle',98,.06]] },
  roomLatch: { noise: [[.2,.24,170,.85],[.075,.13,1260,1.6,.025]] },
  lockerDoor: { noise: [[.12,.13,1270,2],[.32,.095,620,3,.07]], tone: [[286,.22,.03,'triangle',470,.08]] },
  lockerLatch: { noise: [[.12,.18,600,2],[.08,.12,2100,3,.045]] },
  blocked: { noise: [[.12,.13,410,1],[.055,.08,1320,2,.045]] },
  pickup: { noise: [[.09,.12,920,1],[.08,.055,2400,1,.045]] },
  tape: { noise: [[.13,.14,850,1.4]], tone: [[410,.13,.035,'sine'],[620,.19,.045,'sine',620,.09]] },
  repairTool: { noise: [[.028,.045,1150,2],[.04,.025,560,1.4,.07]] },
  generatorStart: { noise: [[.64,.19,215,1.1],[.19,.11,920,2,.17]], tone: [[44,.7,.08,'triangle',76],[69,.45,.04,'sawtooth',118,.16]] },
  unlock: { tone: [[490,.21,.07,'sine'],[735,.33,.065,'sine',735,.16]] },
  elevatorMotor: { noise: [[.8,.16,260,1.1],[.16,.08,840,2,.46]], tone: [[82,.81,.06,'triangle',120]] },
  elevatorOpen: { noise: [[.2,.16,160,1.3]], tone: [[640,.38,.065,'sine'],[960,.44,.05,'sine',960,.13]] },
  escaped: { noise: [[.88,.11,250,1.1]], tone: [[440,.55,.08,'sine'],[660,.62,.08,'sine',660,.18],[880,.7,.07,'sine',880,.36]] },
  transform: { noise: [[.75,.2,490,1.3],[.7,.16,980,1.8,.21]], tone: [[135,.76,.12,'sawtooth',48]] },
  recovery: { noise: [[.78,.13,245,.85]], tone: [[62,.8,.074,'triangle',47]] },
  chase: { noise: [[.46,.16,390,1.3]], tone: [[84,.52,.075,'triangle',54]] },
  beastStep: { noise: [[.12,.23,180,.8],[.09,.1,800,1.1]] },
  attack: { noise: [[.23,.22,760,1.5],[.16,.18,190,.85,.075]], tone: [[112,.2,.08,'triangle',49]] },
  repel: { noise: [[.59,.22,580,1.3],[.37,.1,1460,1.9,.11]], tone: [[145,.56,.09,'triangle',54]] },
  smiler: { noise: [[.94,.11,310,2]], tone: [[87,.95,.035,'sine',80],[91,.95,.032,'sine',85]] },
  freeze: { noise: [[.36,.12,1650,2]], tone: [[390,.38,.046,'triangle',215]] },
  vanish: { noise: [[.65,.15,790,1.5]], tone: [[130,.55,.045,'sine',42]] },
  hurt: { noise: [[.21,.28,200,.9]], tone: [[89,.28,.13,'sine',45]] },
  death: { noise: [[.76,.23,290,1]], tone: [[78,.96,.15,'triangle',29]] },
} satisfies Record<string, { noise?: Noise[]; tone?: Tone[] }>;

export type ParkingCue = keyof typeof cues;

export class ParkingAudio extends GameAudio {
  private readonly voices = new Map<GainNode, AudioScheduledSourceNode[]>();
  private readonly air = this.ctx.createGain();
  private readonly lamps = this.ctx.createGain();
  private readonly engine = this.ctx.createGain();
  private readonly actors = new Map<number, { state: SkinAgent['state']; attackAt: number; x: number; z: number; stride: number }>();
  private smiler?: { actor: Smiler; state: SmilerState; next: number };
  private locallyMuted = false;
  private appliedSettings?: typeof settings;

  constructor() {
    super(undefined, false, settings.volume);
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 185;
    this.air.gain.value = 0;
    this.loop(this.noiseSrc(), lowpass, this.air);
    for (const [bus, hz] of [[this.lamps, 120], [this.engine, 58]] as const) {
      bus.gain.value = 0;
      const oscillator = this.ctx.createOscillator();
      oscillator.frequency.value = hz;
      oscillator.type = 'triangle';
      this.loop(oscillator, bus);
    }
  }

  resume() {
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  setLocalMute(muted: boolean) {
    this.locallyMuted = muted;
    this.setMuted(muted);
    if (muted) this.stopCues();
  }

  environment(active: boolean, room = false, lighting = 0, engine = 0) {
    if (this.appliedSettings !== settings) {
      this.appliedSettings = settings;
      this.setVolume(settings.volume);
      this.setMix();
    }
    const now = this.ctx.currentTime;
    this.air.gain.setTargetAtTime(active ? (room ? .035 : .10) : 0, now, .09);
    this.lamps.gain.setTargetAtTime(active ? lighting * (room ? .018 : .036) : 0, now, .04);
    this.engine.gain.setTargetAtTime(active ? engine * .07 : 0, now, .13);
  }

  play(cue: ParkingCue, gain = 1, pan = 0, obstructed = false) {
    if (this.locallyMuted || this.ctx.state !== 'running' || settings.volume <= 0 || settings.sfx <= 0 || gain < .012) return;
    if (this.voices.size >= 16) this.endVoice(this.voices.keys().next().value!);
    const c = this.ctx, voice = c.createGain(), stereo = c.createStereoPanner(), filter = c.createBiquadFilter();
    voice.gain.value = gain;
    stereo.pan.value = pan;
    filter.type = 'lowpass';
    filter.frequency.value = obstructed ? 650 : 9500;
    voice.connect(filter).connect(stereo).connect(this.sfx);
    const parts: AudioScheduledSourceNode[] = [];
    const data: { noise?: Noise[]; tone?: Tone[] } = cues[cue];
    for (const [seconds, volume, hz, q, delay] of data.noise ?? []) parts.push(this.burst(seconds, volume, hz, q, 'bandpass', delay, voice));
    for (const [hz, seconds, volume, wave, end, delay] of data.tone ?? []) parts.push(this.tone(hz, seconds, volume, wave, delay, end, voice));
    this.voices.set(voice, parts);
    let pending = parts.length;
    for (const part of parts) part.addEventListener('ended', () => {
      if (--pending === 0) {
        this.voices.delete(voice);
        voice.disconnect(); filter.disconnect(); stereo.disconnect();
      }
    }, { once: true });
  }

  encounters(agents: SkinAgent[], smiler: Smiler | undefined, player: ParkingPoint, time: number, emit: (cue: ParkingCue, position: ParkingPoint) => void) {
    for (const agent of agents) {
      const prior = this.actors.get(agent.id);
      const near = agent.pos.floor === player.floor && Math.hypot(agent.pos.x-player.x,agent.pos.z-player.z) < 23;
      let stride = prior && near ? prior.stride + Math.min(.3,Math.hypot(prior.x-agent.pos.x,prior.z-agent.pos.z)) : 0;
      if (near && stride >= (agent.beast ? 1.35 : 1.65)) {
        emit(agent.beast ? 'beastStep' : agent.state === 'run' ? 'sprint' : 'walk', agent.pos);
        stride = 0;
      }
      if (near && prior?.state !== agent.state) {
        const cue = agent.state === 'transform' ? 'transform' : agent.state === 'recover' ? 'recovery'
          : agent.state === 'beast' ? 'chase' : agent.state === 'flee' ? 'repel' : undefined;
        if (cue) emit(cue,agent.pos);
      }
      if (near && prior && agent.attackAt > prior.attackAt) emit('attack',agent.pos);
      this.actors.set(agent.id,{ state:agent.state, attackAt:agent.attackAt, x:agent.pos.x, z:agent.pos.z, stride });
    }
    const prior = this.smiler;
    if (prior && prior.actor !== smiler) emit('vanish',prior.actor.pos);
    if (smiler) {
      const changed = prior?.actor !== smiler || prior.state !== smiler.state;
      const due = prior?.actor === smiler && time >= prior.next;
      if (changed || (smiler.state === 'watch' && due)) {
        emit(smiler.state === 'frozen' ? 'freeze' : 'smiler',smiler.pos);
        this.smiler = { actor:smiler, state:smiler.state, next:time+3.2 };
      }
    } else this.smiler = undefined;
  }

  resetEncounters() {
    this.actors.clear();
    this.smiler = undefined;
    this.stopCues();
  }

  private endVoice(voice: GainNode) {
    for (const source of this.voices.get(voice) ?? []) { try { source.stop(); } catch {} }
    voice.disconnect();
    this.voices.delete(voice);
  }

  stopCues() {
    for (const voice of this.voices.keys()) this.endVoice(voice);
  }

  override dispose() {
    this.stopCues();
    super.dispose();
  }
}
