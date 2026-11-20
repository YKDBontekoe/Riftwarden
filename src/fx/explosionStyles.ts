/**
 * Explosion identities. Every blast is built from the same pooled layers (flash, fireball, sparks, smoke, rings,
 * debris, light); a style decides the mix, so a plasma drone, a shorted jammer, a frozen frostbound walker and a
 * heavy crawler read differently at a glance. Pure data.
 */
export type ExplosionStyle = 'fire' | 'plasma' | 'electric' | 'cryo' | 'heavy';

export interface StyleMix {
  /** Layer multipliers (1 = the classic fire blast). */
  fire: number;
  smoke: number;
  sparks: number;
  embers: number;
  hotSparks: number;
  /** Extra style layers (particle counts at scale 1). */
  plasma: number;
  zap: number;
  frost: number;
  shards: number;
  /** Ground ring / air ring colours (HDR). */
  ring: [number, number, number];
  air: [number, number, number];
  /** Flash light colour and intensity multiplier. */
  light: [number, number, number];
  lightMult: number;
  /** Delayed secondary blasts (count) and seconds of burning wreckage left on the ground. */
  secondaries: number;
  /** Delayed crackling arc bursts around the blast over ~0.6 s. */
  crackle: number;
  linger: number;
  debris: number;
  shake: number;
  scorch: boolean;
}

const BASE: StyleMix = {
  fire: 1, smoke: 1, sparks: 1, embers: 1, hotSparks: 1, plasma: 0, zap: 0, frost: 0, shards: 0,
  ring: [3, 1.3, 0.4], air: [1.6, 1.1, 0.7], light: [1, 0.55, 0.22], lightMult: 1,
  secondaries: 0, crackle: 0, linger: 0, debris: 1, shake: 1, scorch: true,
};

export const STYLES: Record<ExplosionStyle, StyleMix> = {
  fire: BASE,
  // Energy cell rupture: a cyan-violet plasma ball, white sparks, little smoke and no fire.
  plasma: { ...BASE, fire: 0, smoke: 0.35, embers: 0.3, hotSparks: 0.35, plasma: 22, zap: 6, ring: [0.8, 2, 3.6], air: [1.4, 1.8, 3], light: [0.45, 0.75, 1.3], lightMult: 1.2, debris: 0.7 },
  // Shorted electronics: arcing blue-white zaps, a crackling ring and a short dirty puff.
  electric: { ...BASE, fire: 0, smoke: 0.55, sparks: 0.6, embers: 0.3, hotSparks: 0.5, zap: 30, plasma: 10, crackle: 5, ring: [0.7, 1.6, 4], air: [1.6, 2.2, 3.6], light: [0.5, 0.7, 1.4], lightMult: 1.1 },
  // Cryo core: frost cloud, ice shards and a pale ring; no fire, no scorch.
  cryo: { ...BASE, fire: 0, smoke: 0.2, sparks: 0.3, embers: 0, hotSparks: 0.15, frost: 26, shards: 22, ring: [1.6, 2.6, 3.2], air: [2, 2.6, 3], light: [0.6, 0.85, 1.2], lightMult: 0.9, scorch: false },
  // Big machines: secondary cook-offs, burning wreckage, more debris and a heavier shake.
  heavy: { ...BASE, fire: 1.3, smoke: 1.4, sparks: 1.2, embers: 1.4, secondaries: 2, linger: 4.5, debris: 1.5, shake: 1.35, lightMult: 1.3 },
};

export function styleMix(style: ExplosionStyle | undefined): StyleMix {
  return STYLES[style ?? 'fire'] ?? BASE;
}
