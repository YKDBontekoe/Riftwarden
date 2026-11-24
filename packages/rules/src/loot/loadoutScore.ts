import { type CombatStats, computeStats, formatModifier, maxHull, mitigation, type StatKey, type StatOp } from '../combat/stats';
import { ECONOMY } from '../data/defs';
import { equipmentModifiers, itemModifiers, weaponDefFor, weaponSummary } from './equipment';
import type { ItemInstance } from './types';

/**
 * Drone-level loadout scoring (pure). Turns a set of equipped items into a handful of
 * headline numbers (firepower, survivability, mobility, tower support) through the real
 * stat pipeline, and explains what swapping one item does to them. Used by every terminal
 * that shows an item next to the current loadout (storage, market, engineering).
 */

export type ScoreKey = 'dps' | 'ehp' | 'mobility' | 'towers';

export interface LoadoutScore {
  /** Sustained weapon DPS with crits (0 without a weapon). */
  dps: number;
  /** Effective HP at wave 1: (hull + shield) / (1 - mitigation). */
  ehp: number;
  /** Movement index, 100 = base drone (speed, dash recharge weighted 70/30). */
  mobility: number;
  /** Tower support index, 100 = base (damage x fire rate / build cost). */
  towers: number;
  stats: CombatStats;
}

export const SCORE_LABEL: Record<ScoreKey, string> = { dps: 'FIREPOWER', ehp: 'SURVIVABILITY', mobility: 'MOBILITY', towers: 'TOWERS' };
export const SCORE_UNIT: Record<ScoreKey, string> = { dps: 'DPS', ehp: 'EHP', mobility: 'IDX', towers: 'IDX' };
export const SCORE_HELP: Record<ScoreKey, string> = {
  dps: 'Sustained damage per second of the equipped weapon with crits, heat and all equipped modifiers. Ignores overheating pauses.',
  ehp: 'Effective hit points at wave 1: hull + shield capacity, divided by the share of damage left after armor and resistance.',
  mobility: 'Movement index (100 = stock drone): 70% movement speed, 30% dash recharge rate.',
  towers: 'Tower support index (100 = stock): tower damage × tower fire rate ÷ construction cost.',
};
export const SCORE_KEYS: ScoreKey[] = ['dps', 'ehp', 'mobility', 'towers'];

export const COMPARISON_PRIORITIES = ['build', 'balanced', 'firepower', 'survivability', 'towers'] as const;
export type ComparisonPriority = typeof COMPARISON_PRIORITIES[number];
const WEIGHTS: Record<Exclude<ComparisonPriority, 'build'>, Record<ScoreKey, number>> = {
  balanced: { dps: 0.45, ehp: 0.35, mobility: 0.1, towers: 0.1 },
  firepower: { dps: 0.7, ehp: 0.15, mobility: 0.1, towers: 0.05 },
  survivability: { dps: 0.15, ehp: 0.7, mobility: 0.1, towers: 0.05 },
  towers: { dps: 0.1, ehp: 0.1, mobility: 0.1, towers: 0.7 },
};

/**
 * Build-aware weights: start from balanced and shift toward what the current loadout invests in (a tower build
 * cares about tower power, a mobility build about speed), so "is this an upgrade?" follows the build in hand.
 */
export function buildWeights(b: Pick<LoadoutScore, 'mobility' | 'towers'>): Record<ScoreKey, number> {
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, Number.isFinite(v) ? v : 0));
  const towers = 0.1 + clamp((b.towers - 100) / 100, 0.45);
  const mobility = 0.1 + clamp((b.mobility - 100) / 60, 0.2);
  const rest = Math.max(0.2, 1 - towers - mobility);
  return { dps: rest * 0.56, ehp: rest * 0.44, mobility, towers };
}

export function weightsFor(priority: ComparisonPriority, base: Pick<LoadoutScore, 'mobility' | 'towers'>): Record<ScoreKey, number> {
  return priority === 'build' ? buildWeights(base) : WEIGHTS[priority];
}

const live = (items: readonly (ItemInstance | null | undefined)[]) => items.filter((i): i is ItemInstance => !!i && i.category !== 'module');

export function loadoutScore(items: readonly (ItemInstance | null | undefined)[]): LoadoutScore {
  const all = live(items);
  // Two carried weapons: only the one in hand applies its affixes and modules. Firepower is the better of the two
  // (each with its own stat block); the other headlines use the first (primary) weapon.
  const weapons = all.filter((i) => i.category === 'weapon');
  const gear = all.filter((i) => i.category !== 'weapon');
  const list = weapons.length ? [...gear, weapons[0]] : gear;
  const st = computeStats(equipmentModifiers(list));
  let dps = 0;
  for (const weapon of weapons) {
    const w = weaponDefFor(weapon);
    if (w) dps = Math.max(dps, weaponSummary(w, weapon === weapons[0] ? st : computeStats(equipmentModifiers([...gear, weapon]))).dps);
  }
  const pool = maxHull(ECONOMY.playerMaxHp, st) + st.shieldCapacity;
  const ehp = pool / Math.max(0.05, 1 - mitigation(st));
  const mobility = 100 * (0.7 * st.moveSpeedMult + 0.3 * st.dashRechargeMult);
  const towers = (100 * st.turretDamageMult * st.turretFireRateMult) / Math.max(0.01, st.buildCostMult);
  return { dps, ehp, mobility, towers, stats: st };
}

export interface ScoreDelta {
  key: ScoreKey;
  before: number;
  after: number;
  /** Relative change (0.12 = +12%); `before` 0 and `after` > 0 counts as +100%. */
  pct: number;
}

export type Verdict = 'upgrade' | 'downgrade' | 'sidegrade' | 'same';

export interface SwapImpact {
  deltas: ScoreDelta[];
  /** Weighted relative change of the whole loadout. */
  score: number;
  verdict: Verdict;
}

const rel = (a: number, b: number) => (b > 1e-9 ? (a - b) / b : a > 1e-9 ? 1 : 0);

/** The loadout with `candidate` in place of `replaced` (or added to an empty slot). */
export function swapped(equipped: readonly (ItemInstance | null)[], candidate: ItemInstance | null, replaced: ItemInstance | null, targetIndex?: number): ItemInstance[] {
  // Resolve the target before removing duplicate UIDs, including when engineering an owned item in place.
  const at = targetIndex ?? (replaced ? equipped.findIndex((i) => i?.uid === replaced.uid) : -1);
  const out = equipped.map((item, i) => (i === at ? candidate : item?.uid === candidate?.uid ? null : item));
  if (at === -1) out.push(candidate);
  return live(out);
}

/** What equipping `candidate` instead of `replaced` does to the headline numbers. */
export function swapImpact(equipped: readonly (ItemInstance | null)[], candidate: ItemInstance | null, replaced: ItemInstance | null, base?: LoadoutScore, priority: ComparisonPriority = 'balanced', targetIndex?: number): SwapImpact {
  const b = base ?? loadoutScore(equipped);
  const a = loadoutScore(swapped(equipped, candidate, replaced, targetIndex));
  return impactBetween(b, a, priority);
}

/** Compare two scored loadouts (also used for engineering before/after previews). */
export function impactBetween(b: LoadoutScore, a: LoadoutScore, priority: ComparisonPriority = 'balanced'): SwapImpact {
  const deltas = SCORE_KEYS.map((key) => ({ key, before: b[key], after: a[key], pct: rel(a[key], b[key]) })).filter((d) => Math.abs(d.pct) >= 0.001);
  const w = weightsFor(priority, b);
  const score = deltas.reduce((s, d) => s + w[d.key] * Math.max(-1, Math.min(1, d.pct)), 0);
  const gains = deltas.some((d) => d.pct > 0);
  const losses = deltas.some((d) => d.pct < 0);
  let verdict: Verdict = 'same';
  if (gains && !losses) verdict = 'upgrade';
  else if (losses && !gains) verdict = 'downgrade';
  else if (gains && losses) verdict = score >= 0.03 ? 'upgrade' : score <= -0.03 ? 'downgrade' : 'sidegrade';
  return { deltas, score, verdict };
}

export const VERDICT_LABEL: Record<Verdict, string> = { upgrade: 'UPGRADE', downgrade: 'DOWNGRADE', sidegrade: 'SIDEGRADE', same: 'NO CHANGE' };

export interface StatSource {
  uid: string;
  name: string;
  rarity: string;
  op: StatOp;
  value: number;
  text: string;
}

/** Which equipped items contribute to a stat, summed per (item, op). Installed modules count towards their weapon. */
export function statSources(items: readonly (ItemInstance | null | undefined)[], stat: StatKey): StatSource[] {
  const out: StatSource[] = [];
  for (const it of live(items)) {
    const sums = new Map<StatOp, number>();
    for (const m of itemModifiers(it)) if (m.stat === stat) sums.set(m.op, (sums.get(m.op) ?? 0) + m.value);
    for (const [op, value] of sums) if (Math.abs(value) > 1e-12) out.push({ uid: it.uid, name: it.name, rarity: it.rarity, op, value, text: formatModifier(stat, op, value) });
  }
  return out;
}

/** Signed percentage text, "+12%" / "−4.5%". */
export function pctText(p: number): string {
  const v = Math.abs(p * 100);
  const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(0) : v.toFixed(1);
  return `${p >= 0 ? '+' : '−'}${s}%`;
}
