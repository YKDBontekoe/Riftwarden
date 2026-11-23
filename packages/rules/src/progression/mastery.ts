// Weapon-family mastery (docs/progression-design.md §6, §11): using a family earns mastery XP (banked like Warden XP),
// ranks 1-50 give a soft-capped damage bonus with that family, component unlocks, cosmetic finishes, titles and a
// pick-one-of-two perk every 5 ranks. In co-op: +10% mastery XP per other warden (max +30%), a shared-family damage
// bonus and a small aura from veterans. Pure: the arena, the server, the HQ and the tests read it.
import type { StatKey, StatModifier, StatOp } from '../combat/stats';
import type { WeaponFamily } from '../data/defs';
import type { Finish } from '../weapons/build';

/** The standard paints (weapons/build FINISHES). */
const PAINTS: readonly Finish[] = ['arctic', 'gunmetal', 'sand', 'slate'];

export const MASTERY_FAMILIES: readonly WeaponFamily[] = ['plasma', 'rail', 'beam', 'swarm'];
export const MAX_RANK = 50;
export const PERK_EVERY = 5;

export interface FamilyMastery {
  /** Total secured mastery XP. */
  xp: number;
  /** Chosen perk option (0/1) per perk tier (index = tier - 1); -1 = not chosen yet. */
  perks: number[];
  /** Cosmetic finish override for weapons of this family (must be unlocked by rank). */
  finish?: Finish;
}

export type MasteryState = Partial<Record<WeaponFamily, FamilyMastery>>;

/** XP from rank r to r+1. */
export const xpToRank = (r: number): number => 300 + 90 * Math.max(0, Math.floor(r));

export interface RankInfo {
  rank: number;
  into: number;
  need: number;
  frac: number;
}

export function rankInfo(xp: number): RankInfo {
  let rest = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  let rank = 0;
  while (rank < MAX_RANK) {
    const need = xpToRank(rank);
    if (rest < need) return { rank, into: rest, need, frac: rest / need };
    rest -= need;
    rank++;
  }
  return { rank: MAX_RANK, into: 0, need: 0, frac: 1 };
}

export const xpForRank = (rank: number): number => {
  let t = 0;
  for (let r = 0; r < Math.min(MAX_RANK, rank); r++) t += xpToRank(r);
  return t;
};

export const MASTERY_XP_CAP = xpForRank(MAX_RANK);

/** Damage bonus with the family: +0.5% per rank, soft-capped toward +15% (rank 50 ≈ +12%). */
export const rankDamage = (rank: number): number => {
  const raw = 0.005 * Math.max(0, Math.min(MAX_RANK, rank));
  return Math.round(0.15 * (1 - Math.exp(-raw / 0.15)) * 10000) / 10000;
};

// ------------------------------------------------------------------ mastery XP per kill

/** Mastery XP for destroying a machine with a weapon of a family (by role). */
export const MASTERY_XP = { normal: 6, elite: 30, boss: 300, hvt: 120 } as const;

/** Co-op squad bonus: +10% mastery XP per other warden still in the operation (max +30%). */
export const squadMasteryMult = (wardens: number): number => 1 + 0.1 * Math.max(0, Math.min(3, Math.floor(wardens) - 1));

// ------------------------------------------------------------------ component unlocks

/** Components a family must be mastered to roll (drops, crafting, merchants) or refit: [component id, rank]. */
export const COMPONENT_RANKS: Readonly<Record<WeaponFamily, readonly (readonly [string, number])[]>> = {
  plasma: [['mc_scatter', 5], ['pb_long', 10], ['co_prism', 20]],
  rail: [['mc_cycle', 5], ['rb_quad', 10], ['co_prism', 20]],
  beam: [['mc_pulse', 5], ['be_ring', 10], ['co_prism', 20]],
  swarm: [['mc_salvo', 5], ['sw_hive', 10], ['co_prism', 20]],
};

/** Every mastery component lock id (`comp:<family>:<component>`). */
export const ALL_COMPONENT_LOCKS: readonly string[] = MASTERY_FAMILIES.flatMap((f) => COMPONENT_RANKS[f].map(([c]) => `comp:${f}:${c}`)).sort();

export const rankOf = (m: MasteryState | undefined, f: WeaponFamily): number => rankInfo(m?.[f]?.xp ?? 0).rank;

/** Component locks of a mastery state (sorted). */
export function componentLocks(m: MasteryState | undefined): string[] {
  const out: string[] = [];
  for (const f of MASTERY_FAMILIES) for (const [c, r] of COMPONENT_RANKS[f]) if (rankOf(m, f) < r) out.push(`comp:${f}:${c}`);
  return out.sort();
}

/** Rank at which a family unlocks a component (null = always available). */
export const componentRank = (f: WeaponFamily, component: string): number | null => COMPONENT_RANKS[f].find(([c]) => c === component)?.[1] ?? null;

/** `comp:<family>:<id>` locks -> component ids excluded for a family. */
export const excludedComponents = (locks: readonly string[] | undefined, family: WeaponFamily): string[] =>
  (locks ?? []).filter((l) => l.startsWith(`comp:${family}:`)).map((l) => l.slice(6 + family.length));

// ------------------------------------------------------------------ finishes and titles

/** Cosmetic finishes a rank unlocks (any family): standard paints at 10/20, prestige finishes at 30/40/50. */
export const FINISH_RANKS: readonly (readonly [Finish, number])[] = [
  ...PAINTS.map((f, i) => [f, i < 2 ? 10 : 20] as const),
  ['gilded', 30],
  ['iridescent', 40],
  ['ascended', 50],
];

export const finishesAt = (rank: number): Finish[] => FINISH_RANKS.filter(([, r]) => rank >= r).map(([f]) => f);

const TITLE = ['Initiate', 'Adept', 'Expert', 'Veteran', 'Master', 'Grandmaster'];
export const FAMILY_NAME: Record<WeaponFamily, string> = { plasma: 'Plasma', rail: 'Railgun', beam: 'Beam', swarm: 'Swarm' };
export const masteryTitle = (f: WeaponFamily, rank: number): string => `${FAMILY_NAME[f]} ${TITLE[Math.min(5, Math.floor(rank / 10))]}`;

// ------------------------------------------------------------------ perks (pick one of two every 5 ranks)

export interface PerkDef {
  name: string;
  stat: StatKey;
  op: StatOp;
  /** Value at tier 1 (+10% per tier). */
  value: number;
}

/** Per family: alternating perk pairs; tier t offers PAIRS[(t - 1) % n]. */
export const PERKS: Readonly<Record<WeaponFamily, readonly (readonly [PerkDef, PerkDef])[]>> = {
  plasma: [
    [{ name: 'Overclocked Coils', stat: 'fireRateMult', op: 'pct', value: 0.03 }, { name: 'Hot Bolts', stat: 'critChance', op: 'add', value: 0.012 }],
    [{ name: 'Vented Shroud', stat: 'heatEfficiency', op: 'pct', value: 0.05 }, { name: 'Tight Grouping', stat: 'spreadMult', op: 'pct', value: -0.05 }],
    [{ name: 'Bolt Density', stat: 'weaponDamageMult', op: 'pct', value: 0.025 }, { name: 'Coolant Loop', stat: 'coolRateMult', op: 'pct', value: 0.05 }],
  ],
  rail: [
    [{ name: 'Fast Capacitors', stat: 'chargeRateMult', op: 'pct', value: 0.05 }, { name: 'Hardened Slugs', stat: 'critMultiplier', op: 'add', value: 0.06 }],
    [{ name: 'Long Rails', stat: 'rangeMult', op: 'pct', value: 0.05 }, { name: 'Kill Zone', stat: 'eliteDamageMult', op: 'pct', value: 0.04 }],
    [{ name: 'Dense Slugs', stat: 'weaponDamageMult', op: 'pct', value: 0.025 }, { name: 'Heat Dump', stat: 'heatEfficiency', op: 'pct', value: 0.05 }],
  ],
  beam: [
    [{ name: 'Resonance', stat: 'weaponDamageMult', op: 'pct', value: 0.025 }, { name: 'Wide Lens', stat: 'spreadMult', op: 'pct', value: -0.05 }],
    [{ name: 'Elemental Focus', stat: 'elementalPower', op: 'pct', value: 0.04 }, { name: 'Cool Emitter', stat: 'coolRateMult', op: 'pct', value: 0.05 }],
    [{ name: 'Arc Leak', stat: 'arcChance', op: 'add', value: 0.01 }, { name: 'Long Focus', stat: 'rangeMult', op: 'pct', value: 0.05 }],
  ],
  swarm: [
    [{ name: 'Brood Tuning', stat: 'fireRateMult', op: 'pct', value: 0.03 }, { name: 'Wide Uplink', stat: 'rangeMult', op: 'pct', value: 0.05 }],
    [{ name: 'Sting Payload', stat: 'weaponDamageMult', op: 'pct', value: 0.025 }, { name: 'Hunter Logic', stat: 'eliteDamageMult', op: 'pct', value: 0.04 }],
    [{ name: 'Swarm Heat Sink', stat: 'heatEfficiency', op: 'pct', value: 0.05 }, { name: 'Corrosive Brood', stat: 'elementalPower', op: 'pct', value: 0.04 }],
  ],
};

export const perkTiers = (rank: number): number => Math.floor(Math.max(0, Math.min(MAX_RANK, rank)) / PERK_EVERY);

export function perkOptions(f: WeaponFamily, tier: number): readonly [PerkDef, PerkDef] {
  const pairs = PERKS[f];
  const [a, b] = pairs[(Math.max(1, tier) - 1) % pairs.length];
  const k = 1 + 0.1 * (Math.max(1, tier) - 1);
  const s = (p: PerkDef): PerkDef => ({ ...p, value: Math.round(p.value * k * 10000) / 10000 });
  return [s(a), s(b)];
}

/** Why a perk choice is refused (null = allowed). Choices can be changed freely (respec is free). */
export function perkBlocker(m: MasteryState | undefined, f: WeaponFamily, tier: number, option: number): string | null {
  if (!MASTERY_FAMILIES.includes(f)) return 'Unknown weapon family';
  if (!Number.isInteger(tier) || tier < 1 || tier > MAX_RANK / PERK_EVERY) return 'Unknown perk tier';
  if (option !== 0 && option !== 1) return 'Unknown perk option';
  if (perkTiers(rankOf(m, f)) < tier) return `Reach ${FAMILY_NAME[f]} mastery rank ${tier * PERK_EVERY} first`;
  return null;
}

// ------------------------------------------------------------------ modifiers

/** Personal modifiers for the weapon in hand: rank damage + chosen perks of that family. */
export function masteryModifiers(m: MasteryState | undefined, f: WeaponFamily | null | undefined): StatModifier[] {
  if (!f || !m?.[f]) return [];
  const st = m[f]!;
  const rank = rankOf(m, f);
  const out: StatModifier[] = [];
  const dmg = rankDamage(rank);
  if (dmg > 0) out.push({ stat: 'weaponDamageMult', op: 'pct', value: dmg, source: 'mastery' });
  const tiers = perkTiers(rank);
  for (let t = 1; t <= tiers; t++) {
    const o = st.perks[t - 1];
    if (o !== 0 && o !== 1) continue;
    const p = perkOptions(f, t)[o];
    out.push({ stat: p.stat, op: p.op, value: p.value, source: 'mastery' });
  }
  return out;
}

/**
 * Co-op team bonus for one warden: +2/3/4% damage when 2/3/4 wardens hold the same family, plus an aura of +0.2%
 * per perk tier teammates reached in the family (capped at +3%).
 */
export function teamMasteryBonus(self: WeaponFamily | null, team: readonly { family: WeaponFamily | null; rank: number }[]): number {
  if (!self) return 0;
  const same = team.filter((t) => t.family === self).length + 1;
  const shared = same >= 2 ? 0.01 * (same) : 0;
  const aura = Math.min(0.03, team.filter((t) => t.family === self).reduce((s, t) => s + 0.002 * perkTiers(t.rank), 0));
  return Math.round((shared + aura) * 10000) / 10000;
}

// ------------------------------------------------------------------ save

export function sanitizeMastery(raw: unknown): MasteryState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: MasteryState = {};
  for (const f of MASTERY_FAMILIES) {
    const v = r[f];
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const xp = typeof o.xp === 'number' && Number.isFinite(o.xp) ? Math.max(0, Math.min(MASTERY_XP_CAP, Math.floor(o.xp))) : 0;
    const perks = Array.isArray(o.perks) ? o.perks.slice(0, MAX_RANK / PERK_EVERY).map((x) => (x === 0 || x === 1 ? x : -1)) : [];
    const fm: FamilyMastery = { xp, perks };
    const rank = rankInfo(xp).rank;
    if (typeof o.finish === 'string' && finishesAt(rank).includes(o.finish as Finish)) fm.finish = o.finish as Finish;
    out[f] = fm;
  }
  return Object.keys(out).length ? out : undefined;
}
