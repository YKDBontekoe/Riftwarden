import { BPM, ease, type MusicInput, type MusicLayer, musicTarget, MUSIC_TRACKS, type MusicTrack, rootHz, type Stinger, stepPattern } from './musicPlan';
import { sfx } from './Sfx';

const URLS: Record<MusicTrack, string> = {
  hq: new URL('../assets/cc0/music/hq.mp3', import.meta.url).href,
  prep: new URL('../assets/cc0/music/prep.mp3', import.meta.url).href,
  combat: new URL('../assets/cc0/music/combat.mp3', import.meta.url).href,
  boss: new URL('../assets/cc0/music/boss.mp3', import.meta.url).href,
};
/** Seconds of overlap when a loop wraps (the CC0 tracks are not all cut as seamless loops). */
const LOOP_XFADE = 2;
const LOOKAHEAD = 0.12;

interface TrackState {
  gain: GainNode;
  level: number;
  buffer: AudioBuffer | null;
  loading: boolean;
  nextStart: number;
}

/**
 * The adaptive score: CC0 loops crossfaded by game state plus procedural pulse / drums / riser layers following
 * the fight (`musicPlan.ts` decides, this only plays). Lives on the shared `Sfx` context and its music bus, so the
 * master volume, the tactical-mode lowpass and the compressor apply. One instance for the whole app: the score
 * carries across scene transitions and crossfades HQ -> prep -> combat on its own.
 */
export class Music {
  private tracks = new Map<MusicTrack, TrackState>();
  private layers: Record<MusicLayer, { gain: GainNode; level: number }> | null = null;
  private target = musicTarget({ scene: 'hq' });
  private step = 0;
  private nextStep = 0;
  private seed = 1;
  private duckUntil = 0;
  /** Last applied state, for tests and the debug API. */
  state = { tracks: { hq: 0, prep: 0, combat: 0, boss: 0 } as Record<MusicTrack, number>, layers: { pulse: 0, drums: 0, riser: 0 } as Record<MusicLayer, number>, intensity: 0 };

  /** New arena key and groove (a run's seed). */
  reseed(seed: number): void {
    this.seed = seed >>> 0;
  }

  update(dt: number, input: MusicInput): void {
    const ctx = sfx.context;
    const out = sfx.musicOut;
    if (!ctx || !out) return;
    if (!this.layers) this.start(ctx, out);
    this.target = musicTarget(input);
    const ducked = ctx.currentTime < this.duckUntil ? 0.45 : 1;
    for (const id of MUSIC_TRACKS) {
      const want = this.target.tracks[id];
      let t = this.tracks.get(id);
      if (!t && want > 0) t = this.track(ctx, out, id);
      if (!t) continue;
      // Fade in over ~2.5 s, out a little faster, so a boss entrance takes over quickly.
      t.level = ease(t.level, want, dt, want > t.level ? 1.2 : 1.8);
      t.gain.gain.setTargetAtTime(t.level * ducked, ctx.currentTime, 0.05);
      this.state.tracks[id] = t.level;
      if (t.buffer) this.keepLooping(ctx, t);
    }
    for (const k of ['pulse', 'drums', 'riser'] as MusicLayer[]) {
      const l = this.layers![k];
      l.level = ease(l.level, this.target.layers[k], dt, 2);
      l.gain.gain.setTargetAtTime(l.level * ducked * (k === 'riser' ? 0.25 : 0.5), ctx.currentTime, 0.05);
      this.state.layers[k] = l.level;
    }
    this.state.intensity = this.target.intensity;
  }

  /** Brief dip under a big explosion or boss roar. */
  duck(seconds = 0.6): void {
    const ctx = sfx.context;
    if (ctx) this.duckUntil = Math.max(this.duckUntil, ctx.currentTime + seconds);
  }

  /** One-shot musical cue on the music bus (synthesised: chord swells and stabs in the run's key). */
  sting(kind: Stinger): void {
    const ctx = sfx.context;
    const out = sfx.musicOut;
    if (!ctx || !out) return;
    const t = ctx.currentTime + 0.02;
    const root = rootHz(this.seed) * 4;
    const chord = (notes: number[], at: number, len: number, gain: number, type: OscillatorType) => {
      for (const n of notes) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = root * Math.pow(2, n / 12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(gain, at + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        o.connect(g).connect(out);
        o.start(at);
        o.stop(at + len + 0.05);
      }
    };
    if (kind === 'waveClear') [[0, 7], [3, 10], [7, 12, 15]].forEach((n, i) => chord(n, t + i * 0.16, 1.2, 0.07, 'triangle'));
    else if (kind === 'waveStart') chord([-12, 0, 7], t, 0.9, 0.08, 'sawtooth');
    else if (kind === 'checkpoint') [[0, 7, 12], [5, 12, 17], [7, 14, 19]].forEach((n, i) => chord(n, t + i * 0.22, 1.6, 0.06, 'triangle'));
    else if (kind === 'bossIn') { chord([-24, -12, -11], t, 2.4, 0.12, 'sawtooth'); this.duck(1.5); }
    else if (kind === 'bossDown') [[0, 3, 7], [5, 8, 12], [7, 11, 14, 19]].forEach((n, i) => chord(n, t + i * 0.3, 2.2, 0.07, 'triangle'));
    else if (kind === 'jackpot') { [0, 7, 12, 19, 24].forEach((n, i) => chord([n], t + i * 0.07, 0.8, 0.06, 'square')); this.duck(0.8); }
    else chord([-12, -9, -5], t, 3, 0.09, 'sawtooth');
  }

  private start(ctx: AudioContext, out: AudioNode): void {
    const mk = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(out);
      return { gain: g, level: 0 };
    };
    this.layers = { pulse: mk(), drums: mk(), riser: mk() };
    this.nextStep = ctx.currentTime + 0.1;
    // The beat is scheduled against the audio clock with a small lookahead, so frame hitches never shift it.
    setInterval(() => this.schedule(ctx), 25);
  }

  private track(ctx: AudioContext, out: AudioNode, id: MusicTrack): TrackState {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(out);
    const t: TrackState = { gain, level: 0, buffer: null, loading: true, nextStart: 0 };
    this.tracks.set(id, t);
    void fetch(URLS[id])
      .then((r) => r.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        t.buffer = buffer;
        t.loading = false;
        t.nextStart = ctx.currentTime + 0.05;
      })
      .catch(() => {
        t.loading = false; // music is optional: a missing file leaves the layers and the effects
      });
    return t;
  }

  /** Start the next pass of a loop shortly before the current one ends, overlapping by LOOP_XFADE. */
  private keepLooping(ctx: AudioContext, t: TrackState): void {
    if (!t.buffer || ctx.currentTime < t.nextStart - 1) return;
    if (t.level < 0.001 && t.nextStart < ctx.currentTime) {
      // Silent: do not keep a muted track running, but resume in sync when it comes back.
      t.nextStart = ctx.currentTime + 0.05;
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = t.buffer;
    const fade = ctx.createGain();
    const at = Math.max(ctx.currentTime + 0.01, t.nextStart);
    const len = t.buffer.duration;
    const x = Math.min(LOOP_XFADE, len / 4);
    fade.gain.setValueAtTime(0, at);
    fade.gain.linearRampToValueAtTime(1, at + x);
    fade.gain.setValueAtTime(1, at + len - x);
    fade.gain.linearRampToValueAtTime(0, at + len);
    src.connect(fade).connect(t.gain);
    src.start(at);
    src.stop(at + len + 0.05);
    t.nextStart = at + len - x;
  }

  private schedule(ctx: AudioContext): void {
    const L = this.layers;
    if (!L) return;
    const stepLen = 60 / BPM / 4;
    while (this.nextStep < ctx.currentTime + LOOKAHEAD) {
      const at = this.nextStep;
      if (L.drums.level > 0.02) {
        const k = stepPattern('kick', this.step, this.seed);
        if (k.v) this.kick(ctx, at, k.v, L.drums.gain);
        const h = stepPattern('hat', this.step, this.seed);
        if (h.v) this.hat(ctx, at, h.v, L.drums.gain);
      }
      if (L.pulse.level > 0.02) {
        const b = stepPattern('bass', this.step, this.seed);
        if (b.v) this.bass(ctx, at, rootHz(this.seed) * Math.pow(2, b.note / 12), b.v, stepLen * 1.8, L.pulse.gain);
      }
      if (L.riser.level > 0.02 && this.step % 16 === 0) this.riser(ctx, at, stepLen * 16, L.riser.gain);
      this.nextStep += stepLen;
      this.step++;
    }
  }

  private kick(ctx: AudioContext, at: number, v: number, out: AudioNode): void {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, at);
    o.frequency.exponentialRampToValueAtTime(42, at + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.32);
  }

  private hat(ctx: AudioContext, at: number, v: number, out: AudioNode): void {
    const noise = sfx.noiseBuffer;
    if (!noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v * 0.25, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    src.connect(hp).connect(g).connect(out);
    src.start(at, Math.random() * 0.5, 0.06);
  }

  private bass(ctx: AudioContext, at: number, hz: number, v: number, len: number, out: AudioNode): void {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hz;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, at);
    lp.frequency.exponentialRampToValueAtTime(160, at + len);
    lp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(v * 0.35, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, at + len);
    o.connect(lp).connect(g).connect(out);
    o.start(at);
    o.stop(at + len + 0.02);
  }

  private riser(ctx: AudioContext, at: number, len: number, out: AudioNode): void {
    const noise = sfx.noiseBuffer;
    if (!noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(300, at);
    bp.frequency.exponentialRampToValueAtTime(4200, at + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, at);
    g.gain.exponentialRampToValueAtTime(0.6, at + len * 0.95);
    g.gain.linearRampToValueAtTime(0, at + len);
    src.connect(bp).connect(g).connect(out);
    src.start(at);
    src.stop(at + len);
  }
}

export const music = new Music();
