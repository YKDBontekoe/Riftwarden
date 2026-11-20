export type DamageType = 'energy' | 'kinetic' | 'explosive';
export type DamageSource = 'player' | 'turret' | 'enemy';

export interface DamageRoll {
  amount: number;
  crit: boolean;
  weakpoint: boolean;
  type: DamageType;
  source: DamageSource;
}

export interface CritParams {
  critChance: number;
  critMultiplier: number;
}

/**
 * Weakpoint hits are always critical. Otherwise crit is rolled from critChance.
 * A weakpoint hit that also wins the crit roll gets an extra 25% ("overcrit").
 */
export function rollDamage(
  base: number,
  crit: CritParams,
  weakpoint: boolean,
  rand: () => number,
  type: DamageType = 'energy',
  source: DamageSource = 'player',
): DamageRoll {
  const rolled = rand() < crit.critChance;
  const isCrit = weakpoint || rolled;
  let amount = base;
  if (isCrit) amount *= crit.critMultiplier;
  if (weakpoint && rolled) amount *= 1.25;
  return { amount, crit: isCrit, weakpoint, type, source };
}

export interface Health {
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
}

export interface DamageResult {
  toShield: number;
  toHp: number;
  shieldBroken: boolean;
  killed: boolean;
}

/** Shields absorb first. Energy damage is 50% more effective against shields; `pierce` (void) skips them. */
export function applyDamage(h: Health, amount: number, type: DamageType = 'energy', pierce = false): DamageResult {
  const res: DamageResult = { toShield: 0, toHp: 0, shieldBroken: false, killed: false };
  if (h.hp <= 0 || amount <= 0) return res;
  let remaining = amount;
  if (h.shield > 0 && !pierce) {
    const shieldMult = type === 'energy' ? 1.5 : 1;
    const effective = remaining * shieldMult;
    const absorbed = Math.min(h.shield, effective);
    h.shield -= absorbed;
    res.toShield = absorbed;
    remaining -= absorbed / shieldMult;
    if (h.shield <= 0) {
      h.shield = 0;
      res.shieldBroken = true;
    }
  }
  if (remaining > 0) {
    const dealt = Math.min(h.hp, remaining);
    h.hp -= dealt;
    res.toHp = dealt;
    if (h.hp <= 0) {
      h.hp = 0;
      res.killed = true;
    }
  }
  return res;
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
