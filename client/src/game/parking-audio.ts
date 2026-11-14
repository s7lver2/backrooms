import { GameAudio } from './audio';
import { settings } from '../settings';
import type { ParkingPoint } from '@backrooms/shared';
import type { SkinAgent } from './parking-skinwalker-ai';
import type { Smiler, SmilerState } from './parking-smiler-ai';

type Noise = [seconds: number, gain: number, hz: number, q?: number, delay?: number];
type Tone = [hz: number, seconds: number, gain: number, wave: OscillatorType, endHz?: number, delay?: number];
const cues = {
  walk: { noise: [[.09,.14,175,.85],[.085,.095,1150,1.5,.016],[.055,.038,2700,1.1,.051]] },
  sprint: { noise: [[.11,.21,152,.8],[.09,.12,930,1.2,.014],[.07,.048,2420,1.1,.042]] },
  stairs: { noise: [[.095,.17,260,1.1],[.065,.085,1710,1.8,.017],[.11,.035,710,2,.08]] },
  ramp: { noise: [[.1,.15,190,.9],[.13,.082,1170,1.2,.032],[.08,.042,2600,1.4,.075]] },
  splash: { noise: [[.15,.10,770,1],[.13,.085,2600,.8,.026],[.12,.036,3650,1.3,.082]] },
  pipe: { noise: [[.03,.06,890,1.5]], tone: [[326,.4,.036,'sine'],[823,.20,.018,'sine'],[1778,.08,.009,'sine']] },
  metal: { noise: [[.33,.085,530,1.8],[.15,.055,1690,2,.26]], tone: [[184,.42,.028,'triangle',148,.03],[537,.28,.022,'sine',509,.26]] },
  flashlight: { noise: [[.024,.2,3000,2.5],[.025,.1,1500,1.8,.032]] },
  roomDoor: { noise: [[.16,.15,310,1.1],[.34,.08,780,3,.06]], tone: [[173,.38,.034,'triangle',98,.06]] },
  roomLatch: { noise: [[.2,.24,170,.85],[.075,.13,1260,1.6,.025]] },
  lockerDoor: { noise: [[.12,.13,1270,2],[.32,.095,620,3,.07]], tone: [[286,.22,.03,'triangle',470,.08]] },
  lockerLatch: { noise: [[.12,.18,600,2],[.08,.12,2100,3,.045]] },
  blocked: { noise: [[.12,.13,410,1],[.055,.08,1320,2,.045]] },
  pickup: { noise: [[.09,.12,920,1],[.08,.055,2400,1,.045]] },
  tape: { noise: [[.13,.14,850,1.4]], tone: [[410,.13,.035,'sine'],[620,.19,.045,'sine',620,.09]] },
  repairTool: { noise: [[.12,.10,340,1.4],[.18,.08,720,1.8,.095],[.065,.06,1480,2,.19]], tone: [[76,.22,.028,'triangle',56,.045]] },
  generatorStart: { noise: [[.12,.067,190,1],[.14,.083,230,1.1,.15],[.24,.105,270,1.1,.31]], tone: [[41,.57,.041,'triangle',64,.13],[82,.42,.026,'triangle',128,.31]] },
  unlock: { tone: [[490,.21,.07,'sine'],[735,.33,.065,'sine',735,.16]] },
  elevatorMotor: { noise: [[.12,.12,175,1],[1.01,.11,380,1.25,.065],[.69,.042,1850,1.8,.14]], tone: [[54,.95,.041,'triangle',73,.07]] },
  elevatorOpen: { noise: [[.15,.115,160,1.15],[.048,.043,1470,2,.06]], tone: [[650,.28,.036,'sine',648,.1],[1040,.22,.016,'sine',1037,.1]] },
  escaped: { noise: [[.88,.11,250,1.1]], tone: [[440,.55,.08,'sine'],[660,.62,.08,'sine',660,.18],[880,.7,.07,'sine',880,.36]] },
  transform: { noise: [[.26,.13,395,1.8],[.29,.13,680,2,.19],[.42,.13,1180,1.7,.48],[.36,.17,285,1.15,.71]], tone: [[118,.67,.057,'triangle',56,.20],[63,.42,.041,'sine',42,.71]] },
  recovery: { noise: [[.51,.09,295,1.2],[.39,.06,420,2.6,.71]], tone: [[64,.48,.046,'triangle',49],[92,.39,.03,'sine',53,.71]] },
  chase: { noise: [[.51,.15,490,1.6],[.43,.072,840,2.6,.08]], tone: [[109,.49,.065,'triangle',59]] },
  beastStep: { noise: [[.14,.17,116,1],[.105,.085,590,1.15,.03],[.06,.042,1820,1.3,.061]] },
  attack: { noise: [[.21,.17,1130,1.55],[.19,.17,180,1,.08]], tone: [[102,.21,.086,'triangle',42,.035]] },
  repel: { noise: [[.25,.14,1660,2.2],[.42,.11,480,1.3,.12]], tone: [[126,.39,.06,'triangle',52,.03]] },
  smiler: { noise: [[.54,.048,2270,3,.16],[.85,.075,420,2.4]], tone: [[91,.91,.034,'sine',84],[96,.89,.031,'sine',89,.028],[742,.44,.016,'sine',697,.29]] },
  freeze: { noise: [[.23,.092,2480,2.6],[.22,.034,1060,2.5,.076]], tone: [[476,.22,.034,'sine',241]] },
  vanish: { noise: [[.55,.078,890,1.8],[.34,.052,340,1.5,.12]], tone: [[128,.47,.035,'sine',38]] },
  hurt: { noise: [[.21,.28,200,.9]], tone: [[89,.28,.13,'sine',45]] },
  death: { noise: [[.76,.23,290,1]], tone: [[78,.96,.15,'triangle',29]] },
} satisfies Record<string, { noise?: Noise[]; tone?: Tone[] }>;

export type ParkingCue = keyof typeof cues;

export class ParkingAudio extends GameAudio {
  private readonly voices = new Map<GainNode, { sources: AudioScheduledSourceNode[]; filter: BiquadFilterNode; stereo: StereoPannerNode }>();
  private readonly air = this.ctx.createGain();
  private readonly lamps = this.ctx.createGain();
  private readonly engine = this.ctx.createGain();
  private readonly reflection = this.ctx.createConvolver();
  private readonly wet = this.ctx.createGain();
  private readonly actors = new Map<number, { state: SkinAgent['state']; attackAt: number; x: number; z: number; stride: number }>();
  private readonly smilers = new Map<string, { actor: Smiler; state: SmilerState }>();
  private locallyMuted = false;
  private appliedSettings?: typeof settings;

  constructor() {
    super(undefined, false, settings.volume);
    this.wet.gain.value = 0;
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 245;
    this.air.gain.value = 0;
    this.loop(this.noiseSrc(), lowpass, this.air);
    for (const [bus, harmonics] of [
      [this.lamps, [[120, .65], [240, .2], [360, .12]]],
      [this.engine, [[54, .72], [108, .23], [163, .13]]],
    ] as const) {
      bus.gain.value = 0;
      bus.connect(this.amb);
      for (const [hz, volume] of harmonics) {
        const oscillator = this.ctx.createOscillator(), harmonic = this.ctx.createGain();
        oscillator.frequency.value = hz;
        oscillator.type = 'sine';
        harmonic.gain.value = volume;
        // GameAudio owns the sources and nodes for teardown.
        this.loop(oscillator, harmonic);
        harmonic.disconnect();
        harmonic.connect(bus);
      }
    }
    // Short early reflections followed by a diffuse concrete tail, shared by all world sounds.
    const length = Math.floor(this.ctx.sampleRate * .85);
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      let filtered = 0;
      for (let i = 0; i < length; i++) {
        filtered = filtered * .58 + (Math.random() * 2 - 1) * .42;
        const t = i / this.ctx.sampleRate;
        if (t > .025) data[i] = filtered * Math.exp(-t * 8) * .12;
      }
      for (const [delay, intensity] of [[.032, .4], [.057, .26], [.093, .17], [.142, .11]]) {
        data[Math.floor((delay + channel * .004) * this.ctx.sampleRate)] += intensity;
      }
    }
    this.reflection.buffer = impulse;
    this.reflection.connect(this.wet).connect(this.sfx);
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
    this.air.gain.setTargetAtTime(active ? (room ? .025 : .078) : 0, now, .16);
    this.lamps.gain.setTargetAtTime(active ? lighting * (room ? .016 : .03) : 0, now, .04);
    this.engine.gain.setTargetAtTime(active ? engine * .09 : 0, now, .20);
    this.wet.gain.setTargetAtTime(active ? (room ? .065 : .21) : 0, now, .08);
  }

  play(cue: ParkingCue, gain = 1, pan = 0, obstructed = false, inWorld = false) {
    if (this.locallyMuted || this.ctx.state !== 'running' || settings.volume <= 0 || settings.sfx <= 0 || gain < .012) return;
    if (this.voices.size >= 16) this.endVoice(this.voices.keys().next().value!);
    const c = this.ctx, voice = c.createGain(), stereo = c.createStereoPanner(), filter = c.createBiquadFilter();
    voice.gain.value = gain;
    stereo.pan.value = pan;
    filter.type = 'lowpass';
    filter.frequency.value = obstructed ? 800 : 9500;
    voice.connect(filter).connect(stereo).connect(this.sfx);
    if (inWorld) stereo.connect(this.reflection);
    const parts: AudioScheduledSourceNode[] = [];
    const data: { noise?: Noise[]; tone?: Tone[] } = cues[cue];
    for (const [seconds, volume, hz, q, delay] of data.noise ?? []) parts.push(this.burst(seconds, volume, hz, q, 'bandpass', delay, voice));
    for (const [hz, seconds, volume, wave, end, delay] of data.tone ?? []) parts.push(this.tone(hz, seconds, volume, wave, delay, end, voice));
    this.voices.set(voice, { sources: parts, filter, stereo });
    let pending = parts.length;
    for (const part of parts) part.addEventListener('ended', () => {
      if (--pending === 0) this.endVoice(voice, false);
    }, { once: true });
  }

  encounters(agents: Pick<SkinAgent, 'id' | 'pos' | 'beast' | 'state' | 'attackAt'>[], smilers: Smiler | readonly Smiler[] | undefined, player: ParkingPoint, emit: (cue: ParkingCue, position: ParkingPoint) => void) {
    for (const agent of agents) {
      const prior = this.actors.get(agent.id);
      const near = agent.pos.floor === player.floor && Math.hypot(agent.pos.x-player.x,agent.pos.z-player.z) < 23;
      const distance = prior ? Math.hypot(prior.x-agent.pos.x,prior.z-agent.pos.z) : 0;
      let stride = prior && near && distance < 1.5 ? prior.stride + distance : 0;
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
    const active: readonly Smiler[] = Array.isArray(smilers) ? smilers : smilers ? [smilers as Smiler] : [];
    const keys = new Set<string>();
    for (const smiler of active) {
      const key = `${smiler.id}/${smiler.born}`;
      keys.add(key);
      const prior = this.smilers.get(key);
      const changed = prior?.state !== smiler.state;
      if ((changed || smiler.state === 'watch') && this.entityCueDue(key, 3.2, changed)) {
        emit(smiler.state === 'frozen' ? 'freeze' : 'smiler',smiler.pos);
        this.smilers.set(key, { actor: smiler, state: smiler.state });
      }
    }
    for (const [key, prior] of this.smilers) {
      if (keys.has(key)) continue;
      emit('vanish', prior.actor.pos);
      this.clearEntityCue(key);
      this.smilers.delete(key);
    }
  }

  resetEncounters() {
    this.actors.clear();
    for (const key of this.smilers.keys()) this.clearEntityCue(key);
    this.smilers.clear();
    this.stopCues();
  }

  private endVoice(voice: GainNode, stop = true) {
    const bus = this.voices.get(voice);
    if (!bus) return;
    this.voices.delete(voice);
    voice.disconnect();
    bus.filter.disconnect();
    bus.stereo.disconnect();
    if (stop) for (const source of bus.sources) { try { source.stop(); } catch {} }
  }

  stopCues() {
    for (const voice of this.voices.keys()) this.endVoice(voice);
  }

  override dispose() {
    this.stopCues();
    this.reflection.disconnect();
    this.wet.disconnect();
    this.lamps.disconnect();
    this.engine.disconnect();
    super.dispose();
  }
}
