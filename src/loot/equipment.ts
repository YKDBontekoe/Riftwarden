import { BASE_STATS, type CombatStats, computeStats, formatModifier, formatStat, fmtNum, type StatKey, STAT_DEFS, type StatModifier, STAT_KEYS, type StatOp } from '../combat/stats';
import type { WeaponDef } from '../data/defs';
import { baseDef } from './bases';
import type { ItemInstance, RolledStat } from './types';

/**
 * Equipment -> gameplay (pure). The single place where item data becomes stat
 * modifiers and weapon parameters. Gameplay systems only ever see the results.
 */

/** Modifiers an equipped item contributes. Modules contribute nothing until installation exists. */
export function itemModifiers(item: ItemInstance): StatModifier[] {
  if (item.category === 'module') return [];
  const src = item.uid;
  const out: StatModifier[] = [];
  for (const s of item.base) out.push({ stat: s.stat, op: s.op, value: s.value, source: src });
  for (const a of item.affixes) out.push({ stat: a.stat, op: a.op, value: a.value, source: src });
  return out;
}

export function equipmentModifiers(items: readonly (ItemInstance | null | undefined)[]): StatModifier[] {
  const out: StatModifier[] = [];
  for (const it of items) if (it) out.push(...itemModifiers(it));
  return out;
}

/** Effective weapon parameters for an equipped weapon item (null if it is not a usable weapon). */
export function weaponDefFor(item: ItemInstance | null | undefined): WeaponDef | null {
  if (!item || item.category !== 'weapon' || !item.weapon) return null;
  const b = baseDef(item.defId);
  if (!b?.weapon) return null;
  const w = item.weapon;
  return { ...b.weapon.template, id: item.defId, name: item.name.toUpperCase(), damage: w.damage, fireRate: w.fireRate, heatPerShot: w.heatPerShot, coolRate: w.coolRate };
}

// ------------------------------------------------------------------ comparison

export interface CompareRow {
  key: string;
  label: string;
  /** Formatted values (candidate / equipped). Empty string = not present. */
  a: string;
  b: string;
  /** +1 candidate better, -1 worse, 0 equal / not comparable. */
  verdict: -1 | 0 | 1;
}

/** Sum an item's contributions per (stat, op). */
export function statTotals(item: ItemInstance | null | undefined): Map<string, RolledStat> {
  const m = new Map<string, RolledStat>();
  if (!item) return m;
  for (const s of [...item.base, ...item.affixes]) {
    const k = `${s.stat}|${s.op}`;
    const cur = m.get(k);
    if (cur) cur.value += s.value;
    else m.set(k, { stat: s.stat, op: s.op, value: s.value });
  }
  return m;
}

const verdictOf = (a: number, b: number, better: 'higher' | 'lower'): -1 | 0 | 1 => {
  const eps = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Math.abs(a - b) <= eps) return 0;
  return (a > b) === (better === 'higher') ? 1 : -1;
};

/** Weapon fundamentals for display. */
export function weaponSummary(w: WeaponDef, stats: CombatStats = BASE_STATS) {
  const heat = w.heatPerShot / stats.heatEfficiency;
  const rate = w.fireRate * stats.fireRateMult;
  const dmg = w.damage * stats.weaponDamageMult;
  const critFactor = 1 + stats.critChance * (stats.critMultiplier - 1);
  return { damage: dmg, rate, dps: dmg * rate * critFactor, heat, shotsToOverheat: Math.ceil(100 / Math.max(0.01, heat)), cool: w.coolRate * stats.coolRateMult };
}

/**
 * Raw item comparison: every stat either item carries, candidate (a) vs equipped (b).
 * Weapons also compare their base parameters.
 */
export function compareItems(a: ItemInstance, b: ItemInstance | null): CompareRow[] {
  const rows: CompareRow[] = [];
  const wa = weaponDefFor(a);
  const wb = weaponDefFor(b);
  if (wa) {
    const sa = weaponSummary(wa);
    const sb = wb ? weaponSummary(wb) : null;
    const add = (key: string, label: string, va: number, vb: number | undefined, better: 'higher' | 'lower', fmt = fmtNum) =>
      rows.push({ key, label, a: fmt(va), b: vb === undefined ? '' : fmt(vb), verdict: vb === undefined ? 0 : verdictOf(va, vb, better) });
    add('w.damage', 'Damage / shot', sa.damage, sb?.damage, 'higher');
    add('w.rate', 'Fire rate', sa.rate, sb?.rate, 'higher', (v) => `${fmtNum(v)}/s`);
    add('w.dps', 'Base DPS', sa.damage * sa.rate, sb ? sb.damage * sb.rate : undefined, 'higher');
    add('w.heat', 'Heat / shot', sa.heat, sb?.heat, 'lower', (v) => `${fmtNum(v)}%`);
    add('w.cool', 'Cooling', sa.cool, sb?.cool, 'higher', (v) => `${fmtNum(v)}/s`);
  }
  const ta = statTotals(a);
  const tb = statTotals(b);
  const keys = [...new Set([...ta.keys(), ...tb.keys()])];
  keys.sort((x, y) => STAT_KEYS.indexOf(x.split('|')[0] as StatKey) - STAT_KEYS.indexOf(y.split('|')[0] as StatKey));
  for (const k of keys) {
    const [stat, op] = k.split('|') as [StatKey, StatOp];
    const va = ta.get(k)?.value ?? 0;
    const vb = tb.get(k)?.value ?? 0;
    rows.push({
      key: k,
      label: STAT_DEFS[stat].label,
      a: ta.has(k) ? formatModifier(stat, op, va) : '',
      b: tb.has(k) ? formatModifier(stat, op, vb) : '',
      verdict: b ? verdictOf(va, vb, STAT_DEFS[stat].better) : 0,
    });
  }
  return rows;
}

export interface StatPreviewRow {
  stat: StatKey;
  label: string;
  before: string;
  after: string;
  verdict: -1 | 0 | 1;
}

/**
 * Effective drone stats before/after swapping `candidate` in for `replaced`, computed
 * with the real stat pipeline (so stacking and clamps are reflected honestly).
 */
export function statPreview(equipped: readonly (ItemInstance | null)[], candidate: ItemInstance | null, replaced: ItemInstance | null): StatPreviewRow[] {
  const before = computeStats(equipmentModifiers(equipped));
  const after = computeStats(equipmentModifiers([...equipped.filter((i) => i && i.uid !== replaced?.uid && i.uid !== candidate?.uid), candidate]));
  const rows: StatPreviewRow[] = [];
  for (const k of STAT_KEYS) {
    if (Math.abs(before[k] - after[k]) < 1e-9) continue;
    rows.push({ stat: k, label: STAT_DEFS[k].label, before: formatStat(k, before[k]), after: formatStat(k, after[k]), verdict: verdictOf(after[k], before[k], STAT_DEFS[k].better) });
  }
  return rows;
}
