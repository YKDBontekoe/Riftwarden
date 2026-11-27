/**
 * Adaptive score (pure, no WebAudio): which CC0 loop plays and how hard the procedural layers on top of it push.
 * The loops (assets/cc0/music, OpenGameArt CC0) set the mood per state: HQ calm, prep tension, combat, boss.
 * Ambient loops have no usable tempo, so the beat comes from the procedural layers (`Music.ts`), which follow the
 * fight: enemies alive against the cap, events, a boss, a low reactor and the player's kill chain.
 */
export const MUSIC_TRACKS = ['hq', 'prep', 'combat', 'boss'] as const;
export type MusicTrack = (typeof MUSIC_TRACKS)[number];
export type MusicLayer = 'pulse' | 'drums' | 'riser';
export type Stinger = 'waveStart' | 'waveClear' | 'checkpoint' | 'bossIn' | 'bossDown' | 'jackpot' | 'defeat';

export interface MusicInput {
  scene: 'hq' | 'arena';
  phase?: string;
  alive?: number;
  aliveCap?: number;
  boss?: boolean;
  event?: string | null;
  reactorFrac?: number;
  /** Mood tension (MoodDirector), 0..1. */
  tension?: number;
  chain?: number;
}

export interface MusicTarget {
  tracks: Record<MusicTrack, number>;
  layers: Record<MusicLayer, number>;
  intensity: number;
}

/** Beat of the procedural layers. */
export const BPM = 118;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** How hot the fight is, 0..1 (monotone in every pressure input). */
export function musicIntensity(i: MusicInput): number {
  if (i.scene === 'hq' || i.phase !== 'combat') return 0;
  const crowd = clamp01((i.alive ?? 0) / Math.max(1, i.aliveCap ?? 42));
  const danger = 1 - clamp01(i.reactorFrac ?? 1);
  return clamp01(0.25 + crowd * 0.45 + (i.event ? 0.15 : 0) + (i.boss ? 0.3 : 0) + danger * 0.35 + Math.min(0.2, (i.chain ?? 0) * 0.025) + (i.tension ?? 0) * 0.1);
}

export function musicTarget(i: MusicInput): MusicTarget {
  const tracks: Record<MusicTrack, number> = { hq: 0, prep: 0, combat: 0, boss: 0 };
  const layers: Record<MusicLayer, number> = { pulse: 0, drums: 0, riser: 0 };
  if (i.scene === 'hq') {
    tracks.hq = 1;
    return { tracks, layers, intensity: 0 };
  }
  const intensity = musicIntensity(i);
  if (i.phase === 'combat') {
    if (i.boss) tracks.boss = 1;
    else tracks.combat = 1;
    layers.pulse = 0.45 + intensity * 0.55;
    layers.drums = smooth(0.3, 0.65, intensity);
    layers.riser = smooth(0.55, 1, 1 - clamp01(i.reactorFrac ?? 1)) * 0.8;
  } else {
    tracks.prep = 1;
    layers.pulse = 0.2;
  }
  return { tracks, layers, intensity };
}

/** Exponential approach with `dt` (frame-rate independent). */
export function ease(cur: number, target: number, dt: number, rate: number): number {
  return target + (cur - target) * Math.exp(-rate * Math.max(0, dt));
}

/** Minor-pentatonic offsets (semitones) the bass walks over. */
const SCALE = [0, 3, 5, 7, 10];

/**
 * 16-step patterns. Returns the hit velocity (0 = rest) and, for the bass, a semitone offset from the root.
 * Deterministic in (layer, step, seed): a run keeps one groove, a new seed gets a new one.
 */
export function stepPattern(layer: 'kick' | 'hat' | 'bass', step: number, seed: number): { v: number; note: number } {
  const s = ((step % 16) + 16) % 16;
  const h = (((seed + s * 2654435761) >>> 0) % 1000) / 1000;
  if (layer === 'kick') return { v: s % 4 === 0 ? 1 : s === 10 && h > 0.5 ? 0.6 : 0, note: 0 };
  if (layer === 'hat') return { v: s % 2 === 1 ? 0.7 : h > 0.75 ? 0.35 : 0, note: 0 };
  // Bass: eighth-note pulse, root on the downbeats, scale tones otherwise.
  if (s % 2 === 1) return { v: 0, note: 0 };
  const note = s % 8 === 0 ? 0 : SCALE[Math.floor(h * SCALE.length)];
  return { v: s % 4 === 0 ? 1 : 0.7, note };
}

/** Root note (Hz) per seed: low A to low D, so each arena gets its own key. */
export function rootHz(seed: number): number {
  const semis = [0, 2, 3, 5][(seed >>> 0) % 4];
  return 55 * Math.pow(2, semis / 12);
}
