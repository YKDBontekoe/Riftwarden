/**
 * Combat stat block. Every gameplay system reads the computed block (never item data),
 * so equipment, future run upgrades and set bonuses only contribute StatModifiers.
 *
 * Stacking order (per stat):
 *   value = (base + Σ add) × (1 + Σ pct) × Π (1 + mul)   then clamped to [min, max]
 * - 'add'  flat bonus (also used for chance stats: +0.03 crit chance = +3 points)
 * - 'pct'  percentage bonus; all percentages on a stat are summed first (additive)
 * - 'mul'  explicitly multiplicative factor (rare; each one compounds)
 */
export interface CombatStats {
  /** Player weapon damage multiplier. */
  weaponDamageMult: number;
  fireRateMult: number;
  critChance: number;
  /** Critical hit damage multiplier (2 = double damage). */
  critMultiplier: number;
  /** Divides heat generated per shot. */
  heatEfficiency: number;
  /** Multiplies weapon cooling speed. */
  coolRateMult: number;
  moveSpeedMult: number;
  /** Dash charge recharge speed. */
  dashRechargeMult: number;
  maxHealthBonus: number;
  maxHealthMult: number;
  /** Armor rating: reduction = armor / (armor + ARMOR_K). */
  armor: number;
  /** Flat fraction of incoming damage resisted. */
  damageResist: number;
  shieldCapacity: number;
  /** Shield points restored per second while regenerating. */
  shieldRegen: number;
  /** Seconds without damage before the shield starts regenerating. */
  shieldDelay: number;
  turretDamageMult: number;
  turretFireRateMult: number;
  turretRangeMult: number;
  /** Multiplies Sentinel construction cost. */
  buildCostMult: number;
  /** Multiplies tactical energy recharge speed. */
  tacticalRechargeMult: number;
}

export type StatKey = keyof CombatStats;
export type StatOp = 'add' | 'pct' | 'mul';

export interface StatDef {
  key: StatKey;
  label: string;
  base: number;
  min: number;
  max: number;
  /** How bonuses read in the UI. 'ratio' stats are multipliers shown as percent change. */
  kind: 'ratio' | 'chance' | 'flat' | 'seconds' | 'mult';
  /** Which direction is an improvement. */
  better: 'higher' | 'lower';
  group: 'offense' | 'defense' | 'utility' | 'tower';
}

/** Single source of truth for base values, limits and presentation. */
export const STAT_DEFS: Readonly<Record<StatKey, StatDef>> = {
  weaponDamageMult: { key: 'weaponDamageMult', label: 'Weapon damage', base: 1, min: 0.1, max: 1e9, kind: 'ratio', better: 'higher', group: 'offense' },
  fireRateMult: { key: 'fireRateMult', label: 'Fire rate', base: 1, min: 0.25, max: 3, kind: 'ratio', better: 'higher', group: 'offense' },
  critChance: { key: 'critChance', label: 'Critical chance', base: 0.05, min: 0, max: 1, kind: 'chance', better: 'higher', group: 'offense' },
  critMultiplier: { key: 'critMultiplier', label: 'Critical damage', base: 2, min: 1, max: 1e6, kind: 'mult', better: 'higher', group: 'offense' },
  heatEfficiency: { key: 'heatEfficiency', label: 'Heat efficiency', base: 1, min: 0.25, max: 6, kind: 'ratio', better: 'higher', group: 'offense' },
  coolRateMult: { key: 'coolRateMult', label: 'Cooling speed', base: 1, min: 0.25, max: 6, kind: 'ratio', better: 'higher', group: 'offense' },
  moveSpeedMult: { key: 'moveSpeedMult', label: 'Movement speed', base: 1, min: 0.6, max: 1.6, kind: 'ratio', better: 'higher', group: 'utility' },
  dashRechargeMult: { key: 'dashRechargeMult', label: 'Dash recharge', base: 1, min: 0.25, max: 4, kind: 'ratio', better: 'higher', group: 'utility' },
  maxHealthBonus: { key: 'maxHealthBonus', label: 'Hull integrity', base: 0, min: -50, max: 1e12, kind: 'flat', better: 'higher', group: 'defense' },
  maxHealthMult: { key: 'maxHealthMult', label: 'Hull integrity', base: 1, min: 0.5, max: 1e6, kind: 'ratio', better: 'higher', group: 'defense' },
  armor: { key: 'armor', label: 'Armor rating', base: 0, min: 0, max: 1e12, kind: 'flat', better: 'higher', group: 'defense' },
  damageResist: { key: 'damageResist', label: 'Damage resistance', base: 0, min: 0, max: 0.6, kind: 'chance', better: 'higher', group: 'defense' },
  shieldCapacity: { key: 'shieldCapacity', label: 'Shield capacity', base: 0, min: 0, max: 1e12, kind: 'flat', better: 'higher', group: 'defense' },
  shieldRegen: { key: 'shieldRegen', label: 'Shield regeneration', base: 0, min: 0, max: 1e12, kind: 'flat', better: 'higher', group: 'defense' },
  shieldDelay: { key: 'shieldDelay', label: 'Shield regen delay', base: 3, min: 0.5, max: 10, kind: 'seconds', better: 'lower', group: 'defense' },
  turretDamageMult: { key: 'turretDamageMult', label: 'Turret damage', base: 1, min: 0.1, max: 1e9, kind: 'ratio', better: 'higher', group: 'tower' },
  turretFireRateMult: { key: 'turretFireRateMult', label: 'Turret fire rate', base: 1, min: 0.25, max: 3, kind: 'ratio', better: 'higher', group: 'tower' },
  turretRangeMult: { key: 'turretRangeMult', label: 'Turret range', base: 1, min: 0.5, max: 1.8, kind: 'ratio', better: 'higher', group: 'tower' },
  buildCostMult: { key: 'buildCostMult', label: 'Construction cost', base: 1, min: 0.5, max: 2, kind: 'ratio', better: 'lower', group: 'tower' },
  tacticalRechargeMult: { key: 'tacticalRechargeMult', label: 'Tactical recharge', base: 1, min: 0.25, max: 4, kind: 'ratio', better: 'higher', group: 'utility' },
};

export const STAT_KEYS = Object.keys(STAT_DEFS) as StatKey[];

export const BASE_STATS: Readonly<CombatStats> = Object.freeze(Object.fromEntries(STAT_KEYS.map((k) => [k, STAT_DEFS[k].base])) as unknown as CombatStats);

export interface StatModifier {
  stat: StatKey;
  op: StatOp;
  value: number;
  source?: string;
}

export function isStatKey(k: unknown): k is StatKey {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(STAT_DEFS, k);
}

export function computeStats(mods: readonly StatModifier[], base: Readonly<CombatStats> = BASE_STATS): CombatStats {
  const flat = {} as Record<StatKey, number>;
  const pct = {} as Record<StatKey, number>;
  const mul = {} as Record<StatKey, number>;
  for (const k of STAT_KEYS) {
    flat[k] = 0;
    pct[k] = 0;
    mul[k] = 1;
  }
  for (const m of mods) {
    if (!isStatKey(m.stat) || !Number.isFinite(m.value)) continue;
    if (m.op === 'add') flat[m.stat] += m.value;
    else if (m.op === 'pct') pct[m.stat] += m.value;
    else if (m.op === 'mul') mul[m.stat] *= 1 + m.value;
  }
  const out = {} as CombatStats;
  for (const k of STAT_KEYS) {
    const d = STAT_DEFS[k];
    let v = (base[k] + flat[k]) * Math.max(0, 1 + pct[k]) * mul[k];
    if (!Number.isFinite(v)) v = d.base;
    out[k] = Math.min(d.max, Math.max(d.min, v));
  }
  return out;
}

/** Damage mitigation constants (pure; used by Player and tests). */
export const ARMOR_K = 120;
export const MAX_MITIGATION = 0.8;

/**
 * Fraction of incoming damage removed by armor and resistance combined (capped).
 * Armor is measured against the attacker's level scale (`attackerScale`, 1 at wave 1),
 * so the same rating means the same protection against equally levelled enemies.
 */
export function mitigation(stats: Pick<CombatStats, 'armor' | 'damageResist'>, attackerScale = 1): number {
  const armor = Math.max(0, stats.armor);
  const k = ARMOR_K * (Number.isFinite(attackerScale) && attackerScale > 0 ? attackerScale : 1);
  const fromArmor = armor / (armor + k);
  const total = 1 - (1 - fromArmor) * (1 - Math.max(0, stats.damageResist));
  return Math.min(MAX_MITIGATION, Math.max(0, total));
}

/** Player hull maximum from the stat block. */
export function maxHull(base: number, stats: Pick<CombatStats, 'maxHealthBonus' | 'maxHealthMult'>): number {
  return Math.max(1, (base + stats.maxHealthBonus) * stats.maxHealthMult);
}

/** Display helper: the signed bonus a modifier represents, e.g. "+8%", "+12", "-0.3 s". */
export function formatModifier(stat: StatKey, op: StatOp, value: number): string {
  const d = STAT_DEFS[stat];
  const sign = value >= 0 ? '+' : '−';
  const a = Math.abs(value);
  if (op === 'pct' || op === 'mul') return `${sign}${fmtNum(a * 100)}%`;
  if (d.kind === 'chance') return `${sign}${fmtNum(a * 100)}%`;
  if (d.kind === 'mult') return `${sign}${fmtNum(a * 100)}%`;
  if (d.kind === 'seconds') return `${sign}${fmtNum(a)} s`;
  return `${sign}${fmtNum(a)}`;
}

/** Display helper: a final stat value. */
export function formatStat(stat: StatKey, value: number): string {
  const d = STAT_DEFS[stat];
  switch (d.kind) {
    case 'ratio':
      return `${fmtNum(value * 100)}%`;
    case 'chance':
      return `${fmtNum(value * 100)}%`;
    case 'mult':
      return `×${fmtNum(value)}`;
    case 'seconds':
      return `${fmtNum(value)} s`;
    default:
      return fmtNum(value);
  }
}

/** Compact number formatting that stays readable for very large values. */
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  if (a >= 100) return String(Math.round(v));
  if (a >= 10) return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 100) / 100);
}
