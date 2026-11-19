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
  | 'ui'
  | 'pickup'
  | 'lootDrop'
  | 'equip'
  | 'bank'
  | 'railCharge'
  | 'chargeReady'
  | 'railFire'
  | 'vent'
  | 'arc'
  | 'weaponSwitch'
  | 'install'
  | 'uninstall'
  | 'purchase'
  | 'sell'
  | 'press'
  | 'fabricate'
  | 'enhance'
  | 'reroll'
  | 'alarm'
  | 'charge'
  | 'slam'
  | 'heal'
  | 'bossRoar'
  | 'grind'
  | 'beep'
  | 'mortar'
  | 'step';

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
/** Interface sounds (mixed on the UI bus). */
const UI_SOUNDS: ReadonlySet<string> = new Set(['ui', 'equip', 'purchase', 'sell', 'install', 'uninstall', 'press', 'fabricate', 'enhance', 'reroll', 'buildDeny', 'beep', 'bank']);

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  /** M7 mix buses (master <- sfx / ui / ambience). */
  private sfxBus!: GainNode;
  private uiBus!: GainNode;
  private ambBus!: GainNode;
  private mix = { sfx: 1, ui: 0.8, amb: 0.8 };
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
    this.sfxBus = ctx.createGain();
    this.uiBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.sfxBus.gain.value = this.mix.sfx;
    this.uiBus.gain.value = this.mix.ui;
    this.ambBus.gain.value = this.mix.amb;
    for (const b of [this.sfxBus, this.uiBus, this.ambBus]) b.connect(this.master);
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
    loop(0.6).connect(wind).connect(windGain).connect(this.ambBus);
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
    loop(0.4).connect(rumble).connect(rumbleGain).connect(this.ambBus);
    // Reactor hum: detuned low sines.
    const hum = ctx.createGain();
    hum.gain.value = 0.018;
    for (const f of [55, 110.4, 165.3]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(hum);
      o.start();
    }
    hum.connect(this.ambBus);
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

  /** M7: category mix (effects, interface, ambience). */
  setMix(sfxV: number, uiV: number, ambV: number): void {
    this.mix = { sfx: sfxV, ui: uiV, amb: ambV };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(sfxV, t, 0.02);
    this.uiBus.gain.setTargetAtTime(uiV, t, 0.02);
    this.ambBus.gain.setTargetAtTime(ambV, t, 0.05);
  }

  /** Bus for ambience loops (environment). */
  get ambienceOut(): AudioNode | null {
    return this.ctx ? this.ambBus : null;
  }

  // ---------------------------------------------------------------- M7 spatial ambience

  private emitters = new Set<Emitter>();
  /** Listener pose (camera position + yaw), updated by the active world every frame. */
  listen(x: number, y: number, z: number, yaw: number): void {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(x, t, 0.02);
      L.positionY.setTargetAtTime(y, t, 0.02);
      L.positionZ.setTargetAtTime(z, t, 0.02);
      // Babylon is left-handed (+z forward); WebAudio is right-handed: mirror z.
      L.forwardX.setTargetAtTime(Math.sin(yaw), t, 0.02);
      L.forwardY.setTargetAtTime(0, t, 0.02);
      L.forwardZ.setTargetAtTime(-Math.cos(yaw), t, 0.02);
      L.upX.setTargetAtTime(0, t, 0.02);
      L.upY.setTargetAtTime(1, t, 0.02);
      L.upZ.setTargetAtTime(0, t, 0.02);
    }
  }

  /**
   * Positional ambience loop (machinery hum, reactor, vents, ventilation): filtered noise and/or a tone
   * through an HRTF panner with inverse distance attenuation, on the ambience bus. Returns a handle the
   * world disposes with its scene.
   */
  emitter(kind: 'hum' | 'reactor' | 'vent' | 'air' | 'machine', x: number, y: number, z: number, gain = 1, ref = 4): Emitter | null {
    if (!this.ctx || this.emitters.size > 24) return null;
    const ctx = this.ctx;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = ref;
    panner.maxDistance = 120;
    panner.rolloffFactor = 1.2;
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = -z;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(gain, ctx.currentTime, 0.6);
    g.connect(panner).connect(this.ambBus);
    const nodes: AudioScheduledSourceNode[] = [];
    const noise = (rate: number, type: BiquadFilterType, f: number, q: number, v: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = rate;
      const flt = ctx.createBiquadFilter();
      flt.type = type;
      flt.frequency.value = f;
      flt.Q.value = q;
      const vg = ctx.createGain();
      vg.gain.value = v;
      src.connect(flt).connect(vg).connect(g);
      src.start();
      nodes.push(src);
    };
    const tone = (type: OscillatorType, f: number, v: number, lfo = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const vg = ctx.createGain();
      vg.gain.value = v;
      o.connect(vg).connect(g);
      if (lfo) {
        const l = ctx.createOscillator();
        l.frequency.value = lfo;
        const la = ctx.createGain();
        la.gain.value = v * 0.6;
        l.connect(la).connect(vg.gain);
        l.start();
        nodes.push(l);
      }
      o.start();
      nodes.push(o);
    };
    switch (kind) {
      case 'reactor':
        tone('sine', 55, 0.22, 0.25);
        tone('triangle', 110, 0.05, 0.4);
        noise(0.5, 'bandpass', 180, 2, 0.12);
        break;
      case 'hum':
        tone('sine', 60, 0.08);
        tone('sine', 120, 0.04, 0.3);
        break;
      case 'machine':
        tone('sawtooth', 48, 0.025, 0.7);
        noise(0.8, 'bandpass', 900, 3, 0.05);
        break;
      case 'vent':
        noise(1, 'highpass', 2400, 0.7, 0.07);
        break;
      case 'air':
        noise(0.7, 'lowpass', 600, 0.5, 0.09);
        break;
    }
    const em: Emitter = {
      move: (nx, ny, nz) => {
        panner.positionX.value = nx;
        panner.positionY.value = ny;
        panner.positionZ.value = -nz;
      },
      level: (v) => g.gain.setTargetAtTime(v * gain, ctx.currentTime, 0.2),
      dispose: () => {
        if (!this.emitters.delete(em)) return;
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
        setTimeout(() => {
          for (const n of nodes) {
            try {
              n.stop();
            } catch {
              /* already stopped */
            }
          }
          g.disconnect();
          panner.disconnect();
        }, 600);
      },
    };
    this.emitters.add(em);
    return em;
  }

  /** Audio is unlocked (a user gesture started the context). */
  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get emitterCount(): number {
    return this.emitters.size;
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

  private beam: { gain: GainNode; osc: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode } | null = null;

  /** Continuous beam hum (started/stopped with the beam; cheap: two oscillators + noise). */
  beamLoop(on: boolean): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    if (!this.beam) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 96;
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = 193;
      const g2 = ctx.createGain();
      g2.gain.value = 0.25;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 4200;
      const ng = ctx.createGain();
      ng.gain.value = 0.35;
      osc.connect(filter);
      osc2.connect(g2).connect(filter);
      src.connect(nf).connect(ng).connect(filter);
      filter.connect(gain).connect(this.master);
      osc.start();
      osc2.start();
      src.start();
      this.beam = { gain, osc, osc2, filter };
    }
    const t = ctx.currentTime;
    this.beam.gain.gain.cancelScheduledValues(t);
    this.beam.gain.gain.setTargetAtTime(on ? 0.09 : 0, t, on ? 0.03 : 0.06);
    if (on) {
      this.osc('sine', 1800, 400, 0.12, 0.06, this.master);
    }
  }

  /** Beam pitch/brightness follow ramp and heat. */
  beamLevel(ramp: number, heat: number): void {
    if (!this.beam || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.beam.osc.frequency.setTargetAtTime(90 + ramp * 22 + heat * 30, t, 0.05);
    this.beam.osc2.frequency.setTargetAtTime(186 + ramp * 40, t, 0.05);
    this.beam.filter.frequency.setTargetAtTime(1200 + ramp * 900 + heat * 1500, t, 0.08);
  }

  /** M7: >0 while presentation the co-op server already authored is being reproduced locally (no duplicates). */
  suppress = 0;

  /** M7 voice management: concurrent one-shots are capped so dense fights stay clear (and cheap). */
  private voices = 0;
  static readonly MAX_VOICES = 40;
  /** Voices dropped by the cap (diagnostics). */
  dropped = 0;

  play(name: SfxName, o: PlayOpts = {}): void {
    if (this.suppress > 0 || !this.ctx || this.ctx.state !== 'running') return;
    if (this.voices >= Sfx.MAX_VOICES && !UI_SOUNDS.has(name)) {
      this.dropped++;
      return;
    }
    this.voices++;
    setTimeout(() => this.voices--, 450);
    // Rate-limit identical sounds so dense combat does not turn into noise.
    const now = this.ctx.currentTime;
    const minGap = name === 'shoot' ? 0.03 : name === 'hit' || name === 'turretShot' ? 0.035 : 0.02;
    if (now - (this.lastPlay.get(name) ?? -1) < minGap) return;
    this.lastPlay.set(name, now);

    const v = o.volume ?? 1;
    const p = o.pitch ?? 1;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
    pan.connect(UI_SOUNDS.has(name) ? this.uiBus : this.sfxBus);
    const out = pan;
    const j = 0.94 + Math.random() * 0.12; // pitch jitter

    switch (name) {
      case 'shoot':
        this.osc('sawtooth', 1250 * p * j, 220 * p, 0.09, 0.16 * v, out);
        this.osc('square', 2600 * p * j, 900 * p, 0.04, 0.05 * v, out);
        this.noiseBurst(0.06, 0.22 * v, 5200, 1400, out, 'bandpass', 0.8);
        // Body: a short low thump under the zap so each shot lands with weight.
        this.osc('sine', 150 * p, 46, 0.11, 0.36 * v, out);
        this.noiseBurst(0.045, 0.12 * v, 420, 180, out, 'lowpass');
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
      case 'pickup':
        // Rising two-note chirp; pitch carries rarity.
        this.osc('triangle', 660 * p, 990 * p, 0.09, 0.13 * v, out);
        this.osc('sine', 990 * p, 1480 * p, 0.14, 0.09 * v, out, 0.07);
        this.noiseBurst(0.12, 0.04 * v, 6000, 9000, out, 'highpass');
        break;
      case 'lootDrop':
        // Shimmering chime for rare+ drops landing.
        this.osc('sine', 1320 * p, 1320 * p, 0.5, 0.07 * v, out);
        this.osc('sine', 1760 * p, 1760 * p, 0.6, 0.05 * v, out, 0.08);
        this.osc('triangle', 2640 * p, 2640 * p, 0.4, 0.03 * v, out, 0.16);
        break;
      case 'equip':
        this.noiseBurst(0.06, 0.12 * v, 2500, 800, out, 'bandpass', 2);
        this.osc('square', 220, 330, 0.08, 0.07 * v, out, 0.03);
        this.osc('sine', 880, 1320, 0.1, 0.06 * v, out, 0.06);
        break;
      case 'railCharge':
        // Rising capacitor whine (~0.8 s at base charge speed).
        this.osc('sawtooth', 180 * p, 1900 * p, 0.85 / p, 0.05 * v, out);
        this.osc('sine', 360 * p, 3800 * p, 0.85 / p, 0.04 * v, out);
        break;
      case 'railFire':
        // Hypersonic crack + low thump + electric tail.
        this.noiseBurst(0.08, 0.5 * v, 9000, 2500, out, 'highpass', 0.7);
        this.osc('sine', 110 * p, 38, 0.45, 0.55 * v, out);
        this.osc('square', 2400 * p * j, 300, 0.22, 0.07 * v, out);
        this.noiseBurst(0.5, 0.16 * v, 3200, 400, out, 'bandpass', 1.4, 0.03);
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) {
          this.osc('square', 620, 620, 0.16, 0.07 * v, out, i * 0.36);
          this.osc('square', 465, 465, 0.16, 0.07 * v, out, i * 0.36 + 0.18);
        }
        break;
      case 'chargeReady':
        // Two-tone ping: the shot is at full power.
        this.osc('sine', 1760, 1760, 0.07, 0.12 * v, out);
        this.osc('sine', 2640, 2640, 0.09, 0.1 * v, out, 0.05);
        break;
      case 'charge':
        this.osc('sawtooth', 140 * p, 1200 * p, 1.2 / p, 0.06 * v, out);
        this.osc('sine', 280 * p, 2400 * p, 1.2 / p, 0.04 * v, out);
        break;
      case 'slam':
        this.osc('sine', 70 * p, 24, 0.7, 0.75 * v, out);
        this.noiseBurst(0.6, 0.5 * v, 1400 * p, 60, out, 'lowpass', 0.8);
        for (let i = 0; i < 3; i++) this.noiseBurst(0.06, 0.1 * v, 5000, 2000, out, 'highpass', 1, 0.08 + i * 0.1);
        break;
      case 'heal':
        this.osc('sine', 740 * p, 1110 * p, 0.25, 0.05 * v, out);
        this.osc('triangle', 1110 * p, 1480 * p, 0.3, 0.03 * v, out, 0.08);
        break;
      case 'bossRoar':
        this.osc('sawtooth', 55 * p, 38, 1.6, 0.3 * v, out);
        this.osc('square', 82 * p, 41, 1.4, 0.12 * v, out, 0.1);
        this.noiseBurst(1.5, 0.25 * v, 600, 80, out, 'lowpass', 1.2);
        break;
      case 'grind':
        this.noiseBurst(2.2, 0.22 * v, 300, 900, out, 'bandpass', 3);
        this.osc('sawtooth', 48, 62, 2.2, 0.12 * v, out);
        break;
      case 'beep':
        this.osc('square', 1500 * p, 1500 * p, 0.06, 0.05 * v, out);
        break;
      case 'mortar':
        this.osc('sine', 160 * p, 40, 0.4, 0.4 * v, out);
        this.noiseBurst(0.3, 0.3 * v, 3000, 300, out, 'lowpass', 0.9);
        break;
      case 'vent':
        this.noiseBurst(0.45, 0.14 * v, 2500, 9000, out, 'bandpass', 0.9);
        this.osc('sine', 600, 900, 0.12, 0.05 * v, out);
        break;
      case 'arc':
        for (let i = 0; i < 3; i++) this.noiseBurst(0.04, 0.12 * v, 7000, 3000, out, 'highpass', 1, i * 0.03);
        this.osc('square', 1200 * j, 600, 0.08, 0.04 * v, out);
        break;
      case 'weaponSwitch':
        this.noiseBurst(0.08, 0.14 * v, 1800, 600, out, 'bandpass', 2);
        this.osc('triangle', 300, 520, 0.12, 0.08 * v, out, 0.05);
        this.noiseBurst(0.05, 0.1 * v, 3000, 1500, out, 'bandpass', 3, 0.16);
        break;
      case 'install':
        this.noiseBurst(0.06, 0.14 * v, 2600, 900, out, 'bandpass', 2);
        this.osc('triangle', 440, 660, 0.12, 0.09 * v, out, 0.04);
        this.osc('sine', 1320, 1760, 0.2, 0.06 * v, out, 0.12);
        break;
      case 'uninstall':
        this.osc('triangle', 660, 330, 0.18, 0.09 * v, out);
        this.noiseBurst(0.1, 0.1 * v, 900, 2400, out, 'bandpass', 2, 0.06);
        break;
      case 'purchase':
        this.osc('sine', 1046, 1046, 0.12, 0.08 * v, out);
        this.osc('sine', 1568, 1568, 0.3, 0.08 * v, out, 0.07);
        this.noiseBurst(0.04, 0.05 * v, 6000, 3000, out, 'bandpass', 3);
        break;
      case 'sell':
        this.osc('triangle', 784, 523, 0.18, 0.09 * v, out);
        this.osc('sine', 1318, 1318, 0.22, 0.05 * v, out, 0.06);
        break;
      case 'press':
        this.osc('sine', 70, 38, 0.5, 0.4 * v, out, 0.18);
        this.noiseBurst(0.35, 0.22 * v, 1400, 200, out, 'lowpass', 1, 0.18);
        this.osc('sawtooth', 160, 90, 0.2, 0.05 * v, out);
        break;
      case 'fabricate':
        this.osc('sawtooth', 180, 720, 0.6, 0.05 * v, out);
        this.osc('triangle', 523, 523, 0.15, 0.08 * v, out, 0.55);
        this.osc('triangle', 784, 784, 0.15, 0.08 * v, out, 0.65);
        this.osc('sine', 1046, 1046, 0.4, 0.08 * v, out, 0.75);
        break;
      case 'enhance':
        this.osc('sine', 330, 1320, 0.45, 0.09 * v, out);
        this.osc('triangle', 660, 1980, 0.45, 0.04 * v, out, 0.05);
        this.noiseBurst(0.2, 0.05 * v, 5000, 1500, out, 'bandpass', 2, 0.3);
        break;
      case 'reroll':
        for (let i = 0; i < 5; i++) this.osc('square', 600 + i * 180, 600 + i * 180, 0.04, 0.035 * v, out, i * 0.045);
        this.osc('sine', 1400, 1400, 0.25, 0.06 * v, out, 0.25);
        break;
      case 'step':
        // Heavy mechanical footfall: low thump + servo whine + metal clank.
        this.osc('sine', 90 * p, 42, 0.16, 0.32 * v, out);
        this.noiseBurst(0.07, 0.12 * v, 900, 300, out, 'lowpass', 1);
        this.osc('square', 520 * p * j, 380 * p, 0.05, 0.025 * v, out, 0.03);
        break;
      case 'bank':
        this.osc('triangle', 392, 392, 0.2, 0.1 * v, out);
        this.osc('triangle', 523, 523, 0.2, 0.1 * v, out, 0.1);
        this.osc('triangle', 784, 784, 0.5, 0.11 * v, out, 0.2);
        this.osc('sine', 1568, 1568, 0.5, 0.04 * v, out, 0.3);
        break;
    }
  }
}

export const sfx = new Sfx();

/** Positional ambience loop handle. */
export interface Emitter {
  move(x: number, y: number, z: number): void;
  level(v: number): void;
  dispose(): void;
}
