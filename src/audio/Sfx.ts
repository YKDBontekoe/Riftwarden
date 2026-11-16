export type SfxName =
  | 'shoot'
  | 'hit'
  | 'crit'
  | 'shieldHit'
  | 'kill'
  | 'turretShot'
  | 'enemyShot'
  | 'explosion'
  | 'build'
  | 'buildDeny'
  | 'recycle'
  | 'reactorHit'
  | 'playerHurt'
  | 'dash'
  | 'jump'
  | 'overheat'
  | 'waveStart'
  | 'waveClear'
  | 'tacticalOn'
  | 'tacticalOff'
  | 'ui';

interface PlayOpts {
  volume?: number;
  pitch?: number;
  /** Stereo pan -1..1 */
  pan?: number;
}

/**
 * Small procedural sound bank built on WebAudio. Each effect is a short synthesized
 * envelope; a global low-pass is swept during tactical slow-time.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private filter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private lastPlay = new Map<SfxName, number>();
  private volume = 0.7;

  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(this.filter).connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  /** Storm wind, low city rumble and the reactor's hum: quiet looping bed under everything. */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const loop = (rate: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = rate;
      src.start();
      return src;
    };
    // Gusting wind: band-passed noise with a slow LFO on frequency and level.
    const wind = ctx.createBiquadFilter();
    wind.type = 'bandpass';
    wind.frequency.value = 520;
    wind.Q.value = 0.7;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.045;
    loop(0.6).connect(wind).connect(windGain).connect(this.master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 260;
    lfo.connect(lfoAmt).connect(wind.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.11;
    const lfo2Amt = ctx.createGain();
    lfo2Amt.gain.value = 0.025;
    lfo2.connect(lfo2Amt).connect(windGain.gain);
    lfo.start();
    lfo2.start();
    // Distant rumble.
    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 110;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.09;
    loop(0.4).connect(rumble).connect(rumbleGain).connect(this.master);
    // Reactor hum: detuned low sines.
    const hum = ctx.createGain();
    hum.gain.value = 0.018;
    for (const f of [55, 110.4, 165.3]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(hum);
      o.start();
    }
    hum.connect(this.master);
  }

  /** Rolling thunder; `delay` approximates the distance to the strike. */
  thunder(delay = 0.6): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.35;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 3.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 3.5);
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setTactical(active: boolean): void {
    if (!this.ctx) return;
    this.filter.frequency.setTargetAtTime(active ? 1400 : 20000, this.ctx.currentTime, 0.08);
  }

  private osc(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, out: AudioNode, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, vol: number, f0: number, f1: number, out: AudioNode, type: BiquadFilterType = 'bandpass', q = 1, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  play(name: SfxName, o: PlayOpts = {}): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    // Rate-limit identical sounds so dense combat does not turn into noise.
    const now = this.ctx.currentTime;
    const minGap = name === 'shoot' ? 0.03 : name === 'hit' || name === 'turretShot' ? 0.035 : 0.02;
    if (now - (this.lastPlay.get(name) ?? -1) < minGap) return;
    this.lastPlay.set(name, now);

    const v = o.volume ?? 1;
    const p = o.pitch ?? 1;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
    pan.connect(this.master);
    const out = pan;
    const j = 0.94 + Math.random() * 0.12; // pitch jitter

    switch (name) {
      case 'shoot':
        this.osc('sawtooth', 1250 * p * j, 220 * p, 0.09, 0.16 * v, out);
        this.osc('square', 2600 * p * j, 900 * p, 0.04, 0.05 * v, out);
        this.noiseBurst(0.06, 0.22 * v, 5200, 1400, out, 'bandpass', 0.8);
        this.osc('sine', 140 * p, 50, 0.08, 0.25 * v, out);
        break;
      case 'hit':
        this.osc('square', 1900 * j, 1500, 0.04, 0.06 * v, out);
        this.noiseBurst(0.05, 0.12 * v, 3000, 1500, out, 'highpass');
        break;
      case 'crit':
        this.osc('triangle', 2400, 3200, 0.09, 0.14 * v, out);
        this.osc('sine', 3600, 3600, 0.07, 0.07 * v, out, 0.02);
        break;
      case 'shieldHit':
        this.osc('sine', 900 * j, 1300, 0.08, 0.1 * v, out);
        this.noiseBurst(0.08, 0.1 * v, 6000, 3000, out, 'bandpass', 3);
        break;
      case 'kill':
        this.osc('square', 520, 120, 0.18, 0.14 * v, out);
        this.osc('sine', 1800, 2400, 0.08, 0.08 * v, out);
        break;
      case 'turretShot':
        this.osc('square', 900 * j, 300, 0.07, 0.07 * v, out);
        this.noiseBurst(0.05, 0.08 * v, 4500, 2000, out);
        break;
      case 'enemyShot':
        this.osc('sawtooth', 420 * j, 160, 0.22, 0.1 * v, out);
        this.osc('sine', 900, 300, 0.15, 0.06 * v, out);
        break;
      case 'explosion':
        this.noiseBurst(0.9, 0.6 * v, 2200 * p, 70, out, 'lowpass', 0.7);
        this.osc('sine', 120 * p, 30, 0.55, 0.6 * v, out);
        this.noiseBurst(0.12, 0.3 * v, 4500, 1200, out, 'bandpass', 1);
        // debris crackle
        for (let i = 0; i < 4; i++) this.noiseBurst(0.05, 0.08 * v, 6000, 2500, out, 'highpass', 1, 0.12 + Math.random() * 0.5);
        break;
      case 'build':
        this.osc('triangle', 300, 900, 0.25, 0.15 * v, out);
        this.osc('sine', 600, 1800, 0.3, 0.08 * v, out, 0.08);
        this.noiseBurst(0.3, 0.06 * v, 800, 4000, out);
        break;
      case 'buildDeny':
        this.osc('square', 180, 140, 0.12, 0.1 * v, out);
        this.osc('square', 180, 140, 0.12, 0.1 * v, out, 0.14);
        break;
      case 'recycle':
        this.osc('triangle', 900, 250, 0.3, 0.14 * v, out);
        break;
      case 'reactorHit':
        this.osc('sine', 90, 45, 0.35, 0.35 * v, out);
        this.noiseBurst(0.2, 0.12 * v, 900, 300, out, 'lowpass');
        break;
      case 'playerHurt':
        this.osc('sawtooth', 160, 70, 0.22, 0.22 * v, out);
        this.noiseBurst(0.18, 0.2 * v, 1200, 400, out, 'lowpass');
        break;
      case 'dash':
        this.noiseBurst(0.22, 0.28 * v, 600, 4200, out, 'bandpass', 1.6);
        this.osc('sine', 220, 520, 0.16, 0.08 * v, out);
        break;
      case 'jump':
        this.noiseBurst(0.18, 0.12 * v, 400, 1800, out, 'bandpass', 2);
        break;
      case 'overheat':
        this.noiseBurst(0.9, 0.18 * v, 7000, 1500, out, 'highpass');
        this.osc('square', 440, 220, 0.2, 0.08 * v, out);
        break;
      case 'waveStart':
        this.osc('sawtooth', 110, 110, 0.9, 0.12 * v, out);
        this.osc('sawtooth', 165, 165, 0.9, 0.08 * v, out);
        this.osc('sine', 55, 55, 1.0, 0.25 * v, out);
        break;
      case 'waveClear':
        this.osc('triangle', 523, 523, 0.25, 0.12 * v, out);
        this.osc('triangle', 659, 659, 0.25, 0.12 * v, out, 0.12);
        this.osc('triangle', 784, 784, 0.45, 0.12 * v, out, 0.24);
        break;
      case 'tacticalOn':
        this.osc('sine', 800, 180, 0.35, 0.18 * v, out);
        this.noiseBurst(0.4, 0.1 * v, 3000, 300, out, 'lowpass');
        break;
      case 'tacticalOff':
        this.osc('sine', 180, 800, 0.25, 0.14 * v, out);
        break;
      case 'ui':
        this.osc('sine', 1200, 1400, 0.05, 0.08 * v, out);
        break;
    }
  }
}

export const sfx = new Sfx();
