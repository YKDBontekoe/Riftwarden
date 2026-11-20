import { damp } from './anim';

/** Pure arena mood: what the situation asks of fog, exposure and light colour. */
export type Rgb = [number, number, number];

export interface MoodInput {
  /** Threat tier id (1..5). */
  tier: number;
  /** A boss is on the field. */
  boss: boolean;
  event: 'swarm' | 'eliteAssault' | 'instability' | 'hvt' | null;
  /** Reactor integrity 0..1. */
  reactorFrac: number;
  /** Seconds (drives the pulses). */
  time: number;
}

export interface Mood {
  fog: Rgb;
  /** Multiplies the base fog density. */
  fogMul: number;
  exposureAdd: number;
  contrastAdd: number;
  vignetteAdd: number;
  /** Multiplies the sun colour. */
  sunTint: Rgb;
  /** 0..1 how tense the situation is (drives the arena music bed too). */
  tension: number;
  /** Fast pulse added to exposure after blending (not smoothed). */
  flicker: number;
}

export const BASE_FOG: Rgb = [0.3, 0.29, 0.3];

export const calmMood = (): Mood => ({ fog: [...BASE_FOG], fogMul: 1, exposureAdd: 0, contrastAdd: 0, vignetteAdd: 0, sunTint: [1, 1, 1], tension: 0, flicker: 0 });

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function moodFor(i: MoodInput): Mood {
  const m = calmMood();
  const tierK = clamp01(((Number.isFinite(i.tier) ? i.tier : 1) - 1) / 4);
  m.fog = mix(m.fog, [0.5, 0.34, 0.34], tierK * 0.35);
  m.fogMul = 1 + tierK * 0.35;
  m.tension = tierK * 0.15;

  switch (i.event) {
    case 'swarm':
      m.fog = mix(m.fog, [0.55, 0.42, 0.28], 0.4);
      m.fogMul *= 1.2;
      m.tension = Math.max(m.tension, 0.45);
      break;
    case 'instability':
      m.fog = mix(m.fog, [0.2, 0.5, 0.62], 0.35);
      m.flicker = Math.sin(i.time * 6) * 0.025 * (Math.sin(i.time * 1.3) > 0.2 ? 1 : 0.3);
      m.tension = Math.max(m.tension, 0.55);
      break;
    case 'eliteAssault':
      m.fog = mix(m.fog, [0.5, 0.3, 0.22], 0.25);
      m.tension = Math.max(m.tension, 0.5);
      break;
    case 'hvt':
      m.sunTint = [1, 0.95, 0.8];
      m.tension = Math.max(m.tension, 0.3);
      break;
    case null:
      break;
  }

  if (i.boss) {
    m.fog = mix(m.fog, [0.3, 0.09, 0.08], 0.55);
    m.fogMul *= 1.25;
    m.exposureAdd -= 0.06;
    m.contrastAdd += 0.06;
    m.vignetteAdd += 0.06;
    m.sunTint = [1, 0.72, 0.62];
    m.tension = Math.max(m.tension, 0.75);
  }

  const danger = clamp01((0.3 - clamp01(i.reactorFrac)) / 0.3);
  if (danger > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(i.time * 3);
    m.fog = mix(m.fog, [0.6, 0.12, 0.1], danger * 0.4 * pulse);
    m.vignetteAdd += danger * 0.08;
    m.tension = Math.max(m.tension, 0.6 + 0.3 * danger);
  }
  return m;
}

/** Move `cur` toward `target` at rate k (1/s); the fast flicker is copied, not smoothed. */
export function blendMood(cur: Mood, target: Mood, dt: number, k = 1.4): Mood {
  for (let c = 0; c < 3; c++) {
    cur.fog[c] = damp(cur.fog[c], target.fog[c], k, dt);
    cur.sunTint[c] = damp(cur.sunTint[c], target.sunTint[c], k, dt);
  }
  cur.fogMul = damp(cur.fogMul, target.fogMul, k, dt);
  cur.exposureAdd = damp(cur.exposureAdd, target.exposureAdd, k, dt);
  cur.contrastAdd = damp(cur.contrastAdd, target.contrastAdd, k, dt);
  cur.vignetteAdd = damp(cur.vignetteAdd, target.vignetteAdd, k, dt);
  cur.tension = damp(cur.tension, target.tension, k * 0.6, dt);
  cur.flicker = target.flicker;
  return cur;
}
